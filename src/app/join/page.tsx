import { redirect } from "next/navigation";
import { isLivekitInviteId } from "@/lib/livekitInviteLinks";
import JoinGuestNameGate from "./JoinGuestNameGate";

type JoinPageProps = {
  searchParams?: Promise<{
    invite?: string | string[];
    name?: string | string[];
    guest?: string | string[];
  }>;
};

const asSingle = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default async function JoinPage({ searchParams }: JoinPageProps) {
  const resolvedSearch = searchParams ? await searchParams : undefined;

  const joinToken = decodeURIComponent(asSingle(resolvedSearch?.invite) || "").trim();
  if (!isLivekitInviteId(joinToken)) {
    redirect("/videoconference");
  }

  const inviteName =
    (asSingle(resolvedSearch?.name) || asSingle(resolvedSearch?.guest) || "")
      .trim()
      .slice(0, 80);

  return <JoinGuestNameGate joinToken={joinToken} initialName={inviteName} />;
}
