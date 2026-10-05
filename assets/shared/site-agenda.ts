export interface ContentAgendaDay {
  legacyFragments?: ContentAgendaDayFragment[];
  date: string;
  staffing?: ContentAgendaStaffingBlock[];
  locations: ContentAgendaLocation[];
  slots: Array<{
    durationMinutes?: number;
    startsAt: string;
    sessions: Array<{
      id?: string;
      publicAnchor?: string;
      legacyFragments?: ContentAgendaSessionFragment[];
      descriptionHtml: string;
      descriptionMarkdown?: string;
      durationMinutes?: number;
      endsAt?: string;
      endNotRecorded?: boolean;
      locations: string[];
      sessionUrl?: string;
      participation?: { url: string; label: string; message: string };
      presentationUrl?: string;
      legacyPresentationUrl?: string;
      recordingUrl?: string;
      speakers: ContentAgendaSpeaker[];
      title: string;
      track?: string;
      youtube?: string;
    }>;
    time: string;
    title?: string;
  }>;
}

export interface ContentAgendaSessionFragment {
  anchor: string;
  kind: "dialog" | "dialog_label";
  /** Null follows an unassigned session's native display placement without assigning a physical room. */
  roomId: string | null;
}
export interface ContentAgendaDayFragment {
  anchor: string;
  kind: "day" | "day_tab";
}
export interface ContentAgendaSpeakerFragment {
  anchor: string;
  kind: "speakers" | "speakers_tab";
}

export interface ContentAgendaLocation {
  id: string;
  label: string;
}

export interface ContentAgendaSpeaker {
  bioHtml?: string;
  bioMarkdown?: string;
  imageSrc?: string;
  links?: string[];
  name: string;
  moderator?: boolean;
  roleLabel?: string;
  title?: string;
}

export interface ContentAgendaStaffingBlock {
  id: string;
  name: string;
  startAt: string;
  endAt: string;
  locationId: string | null;
  track?: string;
  duties: Array<{ role: string; displayName: string }>;
}
