"use client";

import { useState } from "react";
import { ActivityFeed } from "@/components/activity/activity-feed";
import { CoachContent } from "@/components/coach/coach-content";
import { MoneyContent } from "@/components/money/money-content";
import { MissionNotice } from "./mission-notice";

/*
 * The existing screens with the (optional) mission note. Missions
 * depend on these screens — never the other way round: Activity,
 * Coach and Money only expose small optional hooks and know nothing
 * about missions. These wrappers read the URL, so pages render them
 * inside a Suspense boundary with the plain screen as the fallback.
 */

export function ActivityScreen() {
  const [opened, setOpened] = useState(false);
  return (
    <>
      <MissionNotice screen="activity" transactionOpened={opened} />
      <ActivityFeed onOpenTransaction={() => setOpened(true)} />
    </>
  );
}

export function MissionCoachScreen() {
  const [opened, setOpened] = useState(false);
  return (
    <CoachContent
      notice={<MissionNotice screen="coach" lessonOpened={opened} />}
      onLessonOpened={() => setOpened(true)}
    />
  );
}

export function MoneyScreen() {
  return <MoneyContent banner={<MissionNotice screen="money" />} />;
}
