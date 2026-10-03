export interface ContentAgendaDay {
  date: string;
  locations: ContentAgendaLocation[];
  slots: Array<{
    durationMinutes?: number;
    startsAt: string;
    sessions: Array<{
      id?: string;
      descriptionHtml: string;
      durationMinutes?: number;
      endsAt?: string;
      locations: string[];
      presentationUrl?: string;
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

export interface ContentAgendaLocation {
  id: string;
  label: string;
}

export interface ContentAgendaSpeaker {
  bioHtml?: string;
  imageSrc?: string;
  links?: string[];
  name: string;
  moderator?: boolean;
  title?: string;
}
