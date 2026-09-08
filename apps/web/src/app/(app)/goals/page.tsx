import { permanentRedirect } from "next/navigation";

// Goals moved into My Life. Keep the old route working for bookmarks and in-app links.
export default function GoalsPage() {
  permanentRedirect("/my-life");
}
