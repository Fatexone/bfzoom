import { redirect } from "next/navigation";
import { isLivekitInviteId } from "@/lib/livekitInviteLinks";
import JoinGuestNameGate from "../JoinGuestNameGate";

type JoinRoomPageProps = {
  params: Promise<{
    room: string;
  }>;
  searchParams?: Promise<{
    name?: string | string[];
    guest?: string | string[];
  }>;
};

const asSingle = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default async function JoinRoomPage({ params, searchParams }: JoinRoomPageProps) {
  const resolvedParams = await params;
  const resolvedSearch = searchParams ? await searchParams : undefined;

  const joinToken = decodeURIComponent(resolvedParams.room || "").trim();
  if (!isLivekitInviteId(joinToken)) {
    redirect("/videoconference");
  }

  const inviteName =
    (asSingle(resolvedSearch?.name) || asSingle(resolvedSearch?.guest) || "")
      .trim()
      .slice(0, 80);

  return <JoinGuestNameGate joinToken={joinToken} initialName={inviteName} />;
}
