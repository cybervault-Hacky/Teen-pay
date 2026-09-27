import { PageHeader } from "@/components/layout/page-header";
import { ProfileContent } from "@/components/profile/profile-content";

export const metadata = {
  title: "Profile",
  description: "Your account, family, and preferences.",
};

export default function ProfilePage() {
  return (
    <>
      <PageHeader title="Profile" />
      <ProfileContent />
    </>
  );
}
