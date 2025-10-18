'use client';

import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebaseConfig';
import { User } from '@/types/User';
import ChatSidebar from '@/components/chat/ChatSidebar';
import ChatSystem from '@/components/chat/ChatSystem';

export default function ChatPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // 🔐 Listen to Firebase Auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setCurrentUser({
          id: user.uid,
          email: user.email || '',
          name: user.displayName || 'Utilisateur',
          online: true,
        });
      } else {
        setCurrentUser(null);
      }
    });

    return () => unsubscribe();
  }, []);

  // 🔐 Redirect or block if not authenticated
  if (!currentUser) {
    return (
      <div className="flex items-center justify-center h-screen text-gray-600 text-lg">
        Veuillez vous connecter pour accéder au chat.
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-100">
      {/* 📋 Liste des contacts et invitations */}
      <ChatSidebar
        selectedUser={selectedUser}
        setSelectedUser={setSelectedUser}
        currentUser={currentUser}
      />

      {/* 💬 Fenêtre de chat */}
      <div className="flex-1 p-4">
        <ChatSystem
          selectedUser={selectedUser}
          setSelectedUser={setSelectedUser}
          currentUser={currentUser}
        />
      </div>
    </div>
  );
}
