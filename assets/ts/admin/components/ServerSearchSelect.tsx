import {
  ServerSearchSelect as SharedServerSearchSelect,
  type ServerSearchSelectProps,
} from "../../components/ServerSearchSelect";
import { loadAdminCollection } from "../services/server-collection";

/** Admin transport wrapper around the shared server-backed selector. */
export function ServerSearchSelect<Item, Response>(props: Omit<ServerSearchSelectProps<Item, Response>, "load">) {
  return <SharedServerSearchSelect {...props} load={loadAdminCollection} />;
}
