import { redirect } from "next/navigation";
import JoinGuestNameGate from "../JoinGuestNameGate";

type JoinRoomPageProps = {
  params: Promise<{
    room: string;
  }>;
  searchParams?: Promise<{
    host?: string | string[];
    name?: string | string[];
    guest?: string | string[];
  }>;
};

const asSingle = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default async function JoinRoomPage({ params, searchParams }: JoinRoomPageProps) {
  const resolvedParams = await params;
  const resolvedSearch = searchParams ? await searchParams : undefined;

  const room = decodeURIComponent(resolvedParams.room || "").trim();
  if (!room) {
    redirect("/videoconference");
  }

  const query = new URLSearchParams({ room });
  if (asSingle(resolvedSearch?.host) === "1") {
    query.set("host", "1");
  }
  const inviteName =
    (asSingle(resolvedSearch?.name) || asSingle(resolvedSearch?.guest) || "")
      .trim()
      .slice(0, 80);
  if (inviteName) {
    query.set("name", inviteName);
  }
  if (asSingle(resolvedSearch?.host) === "1") {
    redirect(`/videoconference?${query.toString()}`);
  }

  return <JoinGuestNameGate room={room} initialName={inviteName} />;
}
