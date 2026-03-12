'use client';

import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebaseConfig';
import { User } from '@/types/User';
import ChatShell from '@/components/chat2/ChatShell';

export default function ChatPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);

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

  return <ChatShell currentUser={currentUser} />;
}
