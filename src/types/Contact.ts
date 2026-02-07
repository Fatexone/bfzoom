import type { User } from "./User";

export interface Contact extends User {
  alias: string | undefined;
  contactDocId: string;
}