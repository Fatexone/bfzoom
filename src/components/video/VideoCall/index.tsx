"use client";

import dynamic from "next/dynamic";
import LiveKitCall from "../LiveKit/LiveKitCall";

const USE_LIVEKIT = Boolean(process.env.NEXT_PUBLIC_LIVEKIT_URL);
const PeerVideoCall = dynamic(() => import("./PeerVideoCall"), { ssr: false });

/* =======================================================
   🎥 VISIO — mosaïque multi-participants + Coach IA flottant
======================================================= */
export default function VideoCall({
  roomId,
  isHost,
  guestInviteId,
  sessionIdentity,
  initialLivekitAuth,
  aiTrainingAutoStart,
  audioOnly,
  skipPreJoin,
  defaultDisplayName,
  onLeave,
}: {
  roomId: string;
  isHost: boolean;
  guestInviteId?: string;
  sessionIdentity?: string;
  initialLivekitAuth?: {
    token: string;
    guestTtsToken?: string;
  };
  aiTrainingAutoStart?: boolean;
  audioOnly?: boolean;
  skipPreJoin?: boolean;
  defaultDisplayName?: string;
  onLeave?: () => void;
}) {
  if (USE_LIVEKIT) {
    return (
      <LiveKitVideoCall
        roomId={roomId}
        isHost={isHost}
        guestInviteId={guestInviteId}
        sessionIdentity={sessionIdentity}
        initialLivekitAuth={initialLivekitAuth}
        aiTrainingAutoStart={aiTrainingAutoStart}
        audioOnly={audioOnly}
        skipPreJoin={skipPreJoin}
        defaultDisplayName={defaultDisplayName}
        onLeave={onLeave}
      />
    );
  }
  return <PeerVideoCall roomId={roomId} onLeave={onLeave} />;
}

function LiveKitVideoCall({
  roomId,
  isHost,
  guestInviteId,
  sessionIdentity,
  initialLivekitAuth,
  aiTrainingAutoStart,
  audioOnly,
  skipPreJoin,
  defaultDisplayName,
  onLeave,
}: {
  roomId: string;
  isHost: boolean;
  guestInviteId?: string;
  sessionIdentity?: string;
  initialLivekitAuth?: {
    token: string;
    guestTtsToken?: string;
  };
  aiTrainingAutoStart?: boolean;
  audioOnly?: boolean;
  skipPreJoin?: boolean;
  defaultDisplayName?: string;
  onLeave?: () => void;
}) {
  const focusedExerciseMode = Boolean(aiTrainingAutoStart);

  return (
    <div
      className={`flex min-h-dvh safe-bottom safe-x ${
        focusedExerciseMode
          ? "bg-black text-white"
          : "bg-linear-to-b from-sky-50 via-blue-50 to-sky-100 text-slate-800"
      }`}
    >
      <div className={focusedExerciseMode ? "w-full" : "w-full max-w-6xl mx-auto p-4 sm:p-6"}>
        <LiveKitCall
          roomId={roomId}
          isHost={isHost}
          guestInviteId={guestInviteId}
          sessionIdentity={sessionIdentity}
          initialLivekitAuth={initialLivekitAuth}
          aiTrainingAutoStart={aiTrainingAutoStart}
          audioOnly={audioOnly}
          skipPreJoin={skipPreJoin}
          defaultDisplayName={defaultDisplayName}
          onLeave={onLeave}
        />
      </div>
    </div>
  );
}
