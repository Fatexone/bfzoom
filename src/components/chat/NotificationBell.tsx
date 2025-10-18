"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebaseConfig";
import {
  getFirestore,
  collection,
  getDocs
} from "firebase/firestore";

export default function NotificationBell({
  onClick,
}: {
  onClick?: () => void;
}) {
  const [invitationCount, setInvitationCount] = useState(0);

  useEffect(() => {
    const fetchInvitations = async () => {
      const user = auth.currentUser;
      if (!user) return;

      const db = getFirestore();
      const ref = collection(db, `invitations/${user.uid}/received`);
      const snap = await getDocs(ref);
      setInvitationCount(snap.size);
    };

    fetchInvitations();
  }, []);

  return (
    <div className="relative cursor-pointer" onClick={onClick}>
      <span className="text-2xl">🔔</span>
      {invitationCount > 0 && (
        <span className="absolute -top-1 -right-1 bg-red-600 text-white text-xs px-1 rounded-full">
          {invitationCount}
        </span>
      )}
    </div>
  );
}
