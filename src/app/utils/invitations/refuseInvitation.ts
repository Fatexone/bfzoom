import {
    getFirestore,
    collection,
    query,
    where,
    getDocs,
    deleteDoc
  } from "firebase/firestore";
  
  /**
   * Refuse une invitation d’un utilisateur en supprimant le document d'invitation
   */
  export const refuseInvitation = async (
    currentUserUid: string,
    inviterUid: string
  ) => {
    const db = getFirestore();
  
    const ref = collection(db, `invitations/${currentUserUid}/received`);
  
    const q = query(ref, where("fromUid", "==", inviterUid));
    const snapshot = await getDocs(q);
  
    for (const docSnap of snapshot.docs) {
      await deleteDoc(docSnap.ref);
    }
  };
  