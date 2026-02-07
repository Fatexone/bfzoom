"use client";

import { useEffect, useRef } from "react";
import * as bodyPix from "@tensorflow-models/body-pix";
import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-backend-webgl";

interface BlurredVideoProps {
  stream: MediaStream | null;
  className?: string;
  mirrored?: boolean;
  backgroundBlurAmount?: number;
  edgeBlurAmount?: number;
}

export default function BlurredVideo({
  stream,
  className,
  mirrored = false,
  backgroundBlurAmount = 8,
  edgeBlurAmount = 3,
}: BlurredVideoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modelRef = useRef<bodyPix.BodyPix | null>(null);
  const rafRef = useRef<number | null>(null);
  const processingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      if (!stream || !videoRef.current || !canvasRef.current) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute("webkit-playsinline", "true");

      try {
        await video.play();
      } catch (err) {
        console.warn("⚠️ Lecture flux local bloquée :", err);
      }

      try {
        await tf.setBackend("webgl");
      } catch {
        await tf.setBackend("cpu");
      }
      await tf.ready();

      if (!modelRef.current) {
        modelRef.current = await bodyPix.load({
          architecture: "MobileNetV1",
          outputStride: 16,
          multiplier: 0.75,
          quantBytes: 2,
        });
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const ensureCanvasSize = () => {
        if (!video.videoWidth || !video.videoHeight) return;
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
      };

      const render = async () => {
        if (cancelled || !modelRef.current || !videoRef.current || !canvasRef.current) {
          return;
        }

        if (processingRef.current) {
          rafRef.current = requestAnimationFrame(render);
          return;
        }

        processingRef.current = true;
        try {
          const videoEl = videoRef.current;
          if (videoEl.readyState >= 2) {
            ensureCanvasSize();
            const segmentation = await modelRef.current.segmentPerson(videoEl, {
              flipHorizontal: false,
            });

            bodyPix.drawBokehEffect(
              canvas,
              videoEl,
              segmentation,
              backgroundBlurAmount,
              edgeBlurAmount,
              mirrored
            );
          }
        } catch (err) {
          // Fallback: afficher la video brute si le flou plante
          const videoEl = videoRef.current;
          if (videoEl && videoEl.readyState >= 2) {
            ensureCanvasSize();
            ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
          }
        } finally {
          processingRef.current = false;
          rafRef.current = requestAnimationFrame(render);
        }
      };

      const onReady = () => {
        ensureCanvasSize();
        render();
      };

      if (video.readyState >= 2) {
        onReady();
      } else {
        video.addEventListener("loadedmetadata", onReady, { once: true });
      }
    };

    void setup();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [stream, mirrored, backgroundBlurAmount, edgeBlurAmount]);

  return (
    <div className="relative w-full h-full">
      <video ref={videoRef} className="absolute inset-0 w-0 h-0 opacity-0" />
      <canvas ref={canvasRef} className={className ?? "w-full h-full"} />
    </div>
  );
}