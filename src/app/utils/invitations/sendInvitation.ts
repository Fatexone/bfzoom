import { getFirestore, collection, addDoc, serverTimestamp } from "firebase/firestore";

export const sendInvitation = async (
  fromUid: string,
  fromEmail: string,
  toUid: string
) => {
  const db = getFirestore();
  const ref = collection(db, `invitations/${toUid}/received`);

  await addDoc(ref, {
    fromUid,
    fromEmail,
    status: "pending",
    createdAt: serverTimestamp(),
  });
};
