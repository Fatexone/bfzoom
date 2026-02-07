"use client";

import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/firebaseConfig";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  where,
  DocumentData,
  DocumentSnapshot,
} from "firebase/firestore";
import type { Chat, ChatMessage } from "@/types/Chat";
import type { Contact } from "@/types/Contact";
import type { User } from "@/types/User";

export const useChatList = (currentUserId?: string | null, limitSize = 40) => {
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUserId) {
      queueMicrotask(() => {
        setChats([]);
        setLoading(false);
      });
      return;
    }

    const q = query(
      collection(db, "chats"),
      where("participants", "array-contains", currentUserId),
      orderBy("updatedAt", "desc")
      ,
      limit(limitSize)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const result: Chat[] = snapshot.docs.map((docSnap) => ({
          ...(docSnap.data() as Chat),
          id: docSnap.id,
        }));
        queueMicrotask(() => {
          setChats(result);
          setLoading(false);
        });
      },
      (error) => {
        console.error("Chat list listen error:", error);
        queueMicrotask(() => {
          setLoading(false);
        });
      }
    );

    return () => unsubscribe();
  }, [currentUserId, limitSize]);

  return { chats, loading };
};

const PAGE_SIZE = 40;

export const useChatMessages = (chatId?: string | null) => {
  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([]);
  const [archivedMessages, setArchivedMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [paginationCursor, setPaginationCursor] = useState<DocumentSnapshot | null>(
    null
  );

  useEffect(() => {
    if (!chatId) {
      queueMicrotask(() => {
        setLiveMessages([]);
        setArchivedMessages([]);
        setHasMore(false);
        setPaginationCursor(null);
        setLoading(false);
      });
      return;
    }

    queueMicrotask(() => {
      setLiveMessages([]);
      setArchivedMessages([]);
      setPaginationCursor(null);
      setHasMore(false);
      setLoading(true);
    });

    const q = query(
      collection(db, `chats/${chatId}/messages`),
      orderBy("createdAt", "desc"),
      limit(PAGE_SIZE)
    );

    let cancelled = false;
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (cancelled) return;
        const result: ChatMessage[] = snapshot.docs
          .map((docSnap) => ({
            ...(docSnap.data() as ChatMessage),
            id: docSnap.id,
          }))
          .reverse();
        queueMicrotask(() => {
          setLiveMessages(result);
          setLoading(false);
          setHasMore(snapshot.docs.length === PAGE_SIZE);
          setPaginationCursor((prev) =>
            prev ?? snapshot.docs[snapshot.docs.length - 1] ?? null
          );
        });
      },
      (error) => {
        console.error("Chat messages listen error:", error);
        queueMicrotask(() => {
          setLoading(false);
        });
      }
    );

    return () => unsubscribe();
  }, [chatId]);

  useEffect(() => {
    if (!chatId) {
      setArchivedMessages([]);
    }
  }, [chatId]);

  const loadMore = async () => {
    if (!chatId || loadingMore || !paginationCursor) return;
    setLoadingMore(true);
    try {
      const nextQuery = query(
        collection(db, `chats/${chatId}/messages`),
        orderBy("createdAt", "desc"),
        startAfter(paginationCursor),
        limit(PAGE_SIZE)
      );
      const snapshot = await getDocs(nextQuery);
      if (snapshot.empty) {
        setHasMore(false);
        return;
      }
      const olderMessages = snapshot.docs
        .map((docSnap) => ({
          ...(docSnap.data() as ChatMessage),
          id: docSnap.id,
        }))
        .reverse();
      setArchivedMessages((prev) => [...olderMessages, ...prev]);
      setPaginationCursor(snapshot.docs[snapshot.docs.length - 1]);
      setHasMore(snapshot.docs.length === PAGE_SIZE);
    } catch (error) {
      console.error("loadMore chat messages error:", error);
    } finally {
      setLoadingMore(false);
    }
  };

  const messages = [...archivedMessages, ...liveMessages];
  return {
    messages,
    loading,
    hasMore,
    loadingMore,
    loadMore,
  };
};

export const useUserMap = (userIds: string[]) => {
  const [userMap, setUserMap] = useState<Record<string, User>>({});

  useEffect(() => {
    const missing = userIds.filter((id) => id && !userMap[id]);
    if (missing.length === 0) return;

    let cancelled = false;

    const fetchUsers = async () => {
      const updates: Record<string, User> = {};
      for (const uid of missing) {
        const snap = await getDoc(doc(db, "users", uid));
        if (snap.exists()) {
          const data = snap.data() as DocumentData;
          updates[uid] = {
            id: uid,
            email: data.email ?? "",
            name: data.name ?? "Utilisateur",
            online: data.online ?? false,
          };
        }
      }
      if (!cancelled && Object.keys(updates).length > 0) {
        setUserMap((prev) => ({ ...prev, ...updates }));
      }
    };

    void fetchUsers();
    return () => {
      cancelled = true;
    };
  }, [userIds, userMap]);

  return userMap;
};

export const useContacts = (currentUserId?: string | null) => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUserId) {
      queueMicrotask(() => {
        setContacts([]);
        setLoading(false);
      });
      return;
    }

    const contactsRef = collection(db, `contacts/${currentUserId}/list`);
    queueMicrotask(() => {
      setLoading(true);
    });

    const unsubscribe = onSnapshot(contactsRef, (snapshot) => {
      const contactPromises = snapshot.docs.map(async (docSnap) => {
        const data = docSnap.data() as {
          uid?: string;
          email?: string;
          alias?: string;
        };

        if (!data.uid) {
          return null;
        }

        const userSnap = await getDoc(doc(db, "users", data.uid));
        if (!userSnap.exists()) {
          return null;
        }

        const userData = userSnap.data() as DocumentData;
        return {
          id: data.uid,
          contactDocId: docSnap.id,
          email: userData.email ?? data.email ?? "",
          name: userData.name ?? "Sans nom",
          alias: data.alias,
          online: userData.online ?? false,
        };
      });

      void Promise.all(contactPromises).then((items) => {
        const validContacts = items.filter((item) => item !== null) as Contact[];
        queueMicrotask(() => {
          setContacts(validContacts);
          setLoading(false);
        });
      });
    });

    return () => {
      unsubscribe();
    };
  }, [currentUserId]);

  return { contacts, loading };
};

export const useParticipantIds = (chats: Chat[], currentUserId?: string | null) => {
  return useMemo(() => {
    const ids = new Set<string>();
    chats.forEach((chat) => {
      chat.participants.forEach((id) => {
        if (!currentUserId || id !== currentUserId) ids.add(id);
      });
    });
    return Array.from(ids);
  }, [chats, currentUserId]);
};

export const useChatReadMap = (chats: Chat[], currentUserId?: string | null) => {
  const [readMap, setReadMap] = useState<Record<string, Date | null>>({});

  useEffect(() => {
    if (!currentUserId || chats.length === 0) {
      queueMicrotask(() => {
        setReadMap({});
      });
      return;
    }

    const unsubscribers = chats.map((chat) =>
      onSnapshot(
        doc(db, `chats/${chat.id}/reads`, currentUserId),
        (snap) => {
        const data = snap.data() as { lastReadAt?: { toDate?: () => Date } } | undefined;
        const lastRead = data?.lastReadAt?.toDate ? data.lastReadAt.toDate() : null;
        queueMicrotask(() => {
          setReadMap((prev) => ({ ...prev, [chat.id]: lastRead }));
        });
        }
      )
    );

    return () => {
      unsubscribers.forEach((unsub) => unsub());
    };
  }, [chats, currentUserId]);

  return readMap;
};