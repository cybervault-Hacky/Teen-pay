import { Suspense } from "react";
import { FavouritesClient } from "@/components/contacts/favourites-client";
import { RoleGate } from "@/components/sandbox/role-gate";

export const metadata = {
  title: "Favourites",
  description: "The TeenPay teens you pay often.",
};

export default function ContactsPage() {
  return (
    <RoleGate role="teen">
      <Suspense fallback={null}>
        <FavouritesClient />
      </Suspense>
    </RoleGate>
  );
}
