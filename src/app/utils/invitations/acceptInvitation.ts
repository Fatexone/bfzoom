import {
    getFirestore,
    doc,
    setDoc,
    deleteDoc,
    collection,
    getDoc,
    serverTimestamp
  } from "firebase/firestore";
  
  export const acceptInvitation = async (
    currentUserUid: string,
    inviterUid: string
  ) => {
    const db = getFirestore();
  
    // 1. Récupère les infos de l'inviteur
    const inviterDoc = doc(db, "users", inviterUid);
    const inviterSnap = await getDoc(inviterDoc);
  
    if (!inviterSnap.exists()) throw new Error("Utilisateur introuvable.");
  
    const inviterData = inviterSnap.data();
    const inviterEmail = inviterData.email;
  
    // 2. Ajoute l'inviteur dans MES contacts
    await setDoc(doc(collection(db, `contacts/${currentUserUid}/list`)), {
      email: inviterEmail,
      addedAt: serverTimestamp(),
    });
  
    // 3. Supprime l'invitation
    const invitationRef = collection(db, `invitations/${currentUserUid}/received`);
    const snapshot = await getDoc(doc(invitationRef, inviterUid)); // assumes docId is inviterUid (adapt if needed)
  
    if (snapshot.exists()) {
      await deleteDoc(snapshot.ref);
    }
  };
  