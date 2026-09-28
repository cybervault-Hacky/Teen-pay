import { AuthProvider } from "@/auth/provider";
import type { AuthService } from "@/auth/types";
import ActivityPage from "@/app/activity/page";
import CreateAccountPage from "@/app/create-account/page";
import FamilyPage from "@/app/family/page";
import MoneyPage from "@/app/money/page";
import NotFound from "@/app/not-found";
import HomePage from "@/app/page";
import ParentPage from "@/app/parent/page";
import PayPage from "@/app/pay/page";
import ProfilePage from "@/app/profile/page";
import RequestPage from "@/app/request/page";
import RequestsPage from "@/app/requests/page";
import SendPage from "@/app/send/page";
import MyQrPage from "@/app/qr/page";
import ScanPage from "@/app/qr/scan/page";
import ContactsPage from "@/app/contacts/page";
import CoachPage from "@/app/coach/page";
import MissionsPage from "@/app/missions/page";
import FriendsPage from "@/app/friends/page";
import IdentityPage from "@/app/id/page";
import SignInPage from "@/app/sign-in/page";
import { AppShell } from "@/components/layout/app-shell";
import { FriendDetail } from "@/components/friends/friend-detail";
import { IdentityDetail } from "@/components/identity/identity-detail";
import { MissionDetail } from "@/components/missions/mission-detail";
import { RoleGate } from "@/components/sandbox/role-gate";
import { SpaceDetail } from "@/components/spaces/space-detail";
import { SandboxProvider } from "@/sandbox/store";
import { usePathname } from "./router";

const PAGES: Record<string, () => React.ReactNode> = {
  "/": () => <HomePage />,
  "/pay": () => <PayPage />,
  "/money": () => <MoneyPage />,
  "/activity": () => <ActivityPage />,
  "/family": () => <FamilyPage />,
  "/parent": () => <ParentPage />,
  "/profile": () => <ProfilePage />,
  "/sign-in": () => <SignInPage />,
  "/create-account": () => <CreateAccountPage />,
  "/send": () => <SendPage />,
  "/request": () => <RequestPage />,
  "/requests": () => <RequestsPage />,
  "/qr": () => <MyQrPage />,
  "/qr/scan": () => <ScanPage />,
  "/contacts": () => <ContactsPage />,
  "/coach": () => <CoachPage />,
  "/missions": () => <MissionsPage />,
  "/friends": () => <FriendsPage />,
  "/id": () => <IdentityPage />,
};

/**
 * `/money/[spaceId]`, `/missions/[missionId]`, `/friends/[teenPayId]`
 * and `/id/[teenPayId]` — the real routes are async server components,
 * so tests render what they render: the gated client detail.
 */
function dynamicPage(pathname: string): (() => React.ReactNode) | undefined {
  const identity = /^\/id\/([^/]+)$/.exec(pathname);
  if (identity) {
    const teenPayId = decodeURIComponent(identity[1]!);
    return function IdentityDetailPage() {
      return (
        <RoleGate role="teen">
          <IdentityDetail teenPayId={teenPayId} />
        </RoleGate>
      );
    };
  }
  const friend = /^\/friends\/([^/]+)$/.exec(pathname);
  if (friend) {
    const teenPayId = decodeURIComponent(friend[1]!);
    return function FriendPage() {
      return (
        <RoleGate role="teen">
          <FriendDetail teenPayId={teenPayId} />
        </RoleGate>
      );
    };
  }
  const mission = /^\/missions\/([^/]+)$/.exec(pathname);
  if (mission) {
    const missionId = decodeURIComponent(mission[1]!);
    return function MissionPage() {
      return (
        <RoleGate role="teen">
          <MissionDetail missionId={missionId} />
        </RoleGate>
      );
    };
  }
  const space = /^\/money\/([^/]+)$/.exec(pathname);
  if (!space) return undefined;
  const spaceId = decodeURIComponent(space[1]!);
  return function SpacePage() {
    return (
      <RoleGate role="teen">
        <SpaceDetail spaceId={spaceId} />
      </RoleGate>
    );
  };
}

function Page() {
  const pathname = usePathname();
  const render = PAGES[pathname] ?? dynamicPage(pathname);
  return <>{render ? render() : <NotFound />}</>;
}

/** The real provider stack and shell, with the real page modules. */
export function TestApp({ service, now }: { service?: AuthService; now?: () => number }) {
  return (
    <AuthProvider service={service} now={now}>
      <SandboxProvider>
        <AppShell>
          <Page />
        </AppShell>
      </SandboxProvider>
    </AuthProvider>
  );
}
