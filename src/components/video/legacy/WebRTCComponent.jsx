'use client';

import { useEffect, useRef } from 'react';
import { socket } from '@/lib/socket';

export default function WebRTCComponent() {
  const peerConnection = useRef(null);

  useEffect(() => {
    const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    peerConnection.current = new RTCPeerConnection(configuration);

    // Écoute des événements ICE
    peerConnection.current.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('signal', { target: 'TARGET_SOCKET_ID', signal: event.candidate });
      }
    };

    // Écoute des tracks média reçues
    peerConnection.current.ontrack = (event) => {
      const remoteStream = new MediaStream();
      remoteStream.addTrack(event.track);
      // Attache ce flux à une balise vidéo par exemple
      const remoteVideo = document.getElementById('remoteVideo');
      if (remoteVideo) remoteVideo.srcObject = remoteStream;
    };

    // Connexion socket
    socket.on('connect', () => {
      console.log('Connexion Socket.IO réussie');
    });

    // Réception d'un signal
    socket.on('signal', async ({ caller, signal }) => {
      if (signal.type === 'offer') {
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(signal));
        const answer = await peerConnection.current.createAnswer();
        await peerConnection.current.setLocalDescription(answer);
        socket.emit('signal', { target: caller, signal: answer });
      } else if (signal.type === 'answer') {
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(signal));
      } else if (signal.candidate) {
        await peerConnection.current.addIceCandidate(new RTCIceCandidate(signal));
      }
    });

    return () => {
      peerConnection.current.close();
      socket.off('signal');
      socket.off('connect');
    };
  }, []);

  // Obtention et partage du flux local
  async function startLocalStream() {
    const localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    localStream.getTracks().forEach((track) => peerConnection.current.addTrack(track, localStream));
    const localVideo = document.getElementById('localVideo');
    if (localVideo) localVideo.srcObject = localStream;

    const offer = await peerConnection.current.createOffer();
    await peerConnection.current.setLocalDescription(offer);
    socket.emit('signal', { target: 'TARGET_SOCKET_ID', signal: offer });
  }

  return (
    <div>
      <button onClick={startLocalStream}>Démarrer la caméra</button>
      <video id="localVideo" autoPlay playsInline muted className="w-48 h-32 border rounded"></video>
      <video id="remoteVideo" autoPlay playsInline className="w-48 h-32 border rounded"></video>
    </div>
  );
}
