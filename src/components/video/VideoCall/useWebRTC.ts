import { useEffect, useRef, useState } from "react";
import { socket } from "@/lib/socket";

export function useWebRTC(roomId: string) {
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    const configuration = {
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    };

    const init = async () => {
      try {
        const localStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        localStreamRef.current = localStream;

        const pc = new RTCPeerConnection(configuration);
        peerConnectionRef.current = pc;

        localStream.getTracks().forEach((track) =>
          pc.addTrack(track, localStream)
        );

        pc.ontrack = (event) => {
          setRemoteStream(event.streams[0]);
        };

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            socket.emit("candidate", {
              roomId,
              candidate: event.candidate.toJSON(),
            });
          }
        };

        socket.on("offer", async ({ offer }) => {
          await pc.setRemoteDescription(offer);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit("answer", { roomId, answer });
        });

        socket.on("answer", async ({ answer }) => {
          await pc.setRemoteDescription(answer);
        });

        socket.on("candidate", async ({ candidate }) => {
          if (candidate) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (err) {
              console.error("Erreur ICE:", err);
            }
          }
        });

        // Création de l'offre si premier utilisateur
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit("offer", { roomId, offer });
      } catch (error) {
        console.error("Erreur init WebRTC:", error);
      }
    };

    init();

    return () => {
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
      socket.off("offer");
      socket.off("answer");
      socket.off("candidate");
    };
  }, [roomId]);

  return {
    localStream: localStreamRef.current,
    remoteStream,
  };
}
