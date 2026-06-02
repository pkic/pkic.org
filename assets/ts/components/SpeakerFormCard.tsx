import type { Ref } from "preact";
import { ProfileLinksInput, type ProfileLinksHandle } from "./ProfileLinksInput";

export interface SpeakerFieldNames {
  firstName: string;
  lastName: string;
  email: string;
  organizationName: string;
  jobTitle: string;
  bio: string;
  role?: string;
}

interface SpeakerFormCardProps {
  title: string;
  idPrefix: string;
  fields: SpeakerFieldNames;
  linksFieldName: string;
  linksRef: Ref<ProfileLinksHandle>;
  emailHelp: string;
  bioHelp: string;
  autocomplete?: boolean;
  defaultRole?: string;
  errorPaths?: Partial<Record<"firstName" | "lastName" | "email" | "bio", string>>;
  onRemove?: () => void;
}

const ROLES = [
  { value: "proposer", label: "Proposer" },
  { value: "speaker", label: "Speaker" },
  { value: "co_speaker", label: "Co-speaker" },
  { value: "moderator", label: "Moderator" },
  { value: "panelist", label: "Panelist" },
] as const;

function FieldError({ path }: { path: string }) {
  return <div data-field-error={path} class="invalid-feedback d-block" />;
}

function OptionalHint() {
  return <span class="text-muted fw-normal small">(optional)</span>;
}

export function SpeakerFormCard({
  title,
  idPrefix,
  fields,
  linksFieldName,
  linksRef,
  emailHelp,
  bioHelp,
  autocomplete,
  defaultRole = "speaker",
  errorPaths,
  onRemove,
}: SpeakerFormCardProps) {
  return (
    <div class="proposal-speaker-card">
      <div class="proposal-speaker-card-head">
        <span class="proposal-speaker-card-title">{title}</span>
        {onRemove && (
          <button type="button" class="btn btn-link btn-sm text-danger p-0" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
      <div class="row g-3 mt-0">
        <div class="col-sm-6">
          <label class="form-label" htmlFor={`${idPrefix}-first`}>
            First name
          </label>
          <input
            id={`${idPrefix}-first`}
            name={fields.firstName}
            type="text"
            class="form-control"
            required
            {...(autocomplete ? { autocomplete: "given-name" } : {})}
          />
          {errorPaths?.firstName && <FieldError path={errorPaths.firstName} />}
        </div>
        <div class="col-sm-6">
          <label class="form-label" htmlFor={`${idPrefix}-last`}>
            Last name
          </label>
          <input
            id={`${idPrefix}-last`}
            name={fields.lastName}
            type="text"
            class="form-control"
            required
            {...(autocomplete ? { autocomplete: "family-name" } : {})}
          />
          {errorPaths?.lastName && <FieldError path={errorPaths.lastName} />}
        </div>
        <div class="col-12">
          <label class="form-label" htmlFor={`${idPrefix}-email`}>
            Email
          </label>
          <input
            id={`${idPrefix}-email`}
            name={fields.email}
            type="email"
            class="form-control"
            required
            {...(autocomplete ? { autocomplete: "email" } : {})}
          />
          <div class="form-text">{emailHelp}</div>
          {errorPaths?.email && <FieldError path={errorPaths.email} />}
        </div>
        <div class="col-sm-6">
          <label class="form-label" htmlFor={`${idPrefix}-org`}>
            Organization <OptionalHint />
          </label>
          <input
            id={`${idPrefix}-org`}
            name={fields.organizationName}
            type="text"
            class="form-control"
            {...(autocomplete ? { autocomplete: "organization" } : {})}
          />
        </div>
        <div class="col-sm-6">
          <label class="form-label" htmlFor={`${idPrefix}-title`}>
            Job title <OptionalHint />
          </label>
          <input
            id={`${idPrefix}-title`}
            name={fields.jobTitle}
            type="text"
            class="form-control"
            {...(autocomplete ? { autocomplete: "organization-title" } : {})}
          />
        </div>
        <div class="col-12">
          <label class="form-label" htmlFor={`${idPrefix}-bio`}>
            Bio
          </label>
          <textarea
            id={`${idPrefix}-bio`}
            name={fields.bio}
            rows={4}
            class="form-control"
            required
            minLength={40}
            maxLength={5000}
          />
          <div class="form-text">{bioHelp}</div>
          {errorPaths?.bio && <FieldError path={errorPaths.bio} />}
        </div>
        {fields.role && (
          <div class="col-12">
            <label class="form-label">Role</label>
            <div class="event-flow-role-options" role="group" aria-label="Speaker role">
              {ROLES.map((role, i) => (
                <>
                  <input
                    class="btn-check"
                    type="radio"
                    name={fields.role}
                    id={`role-${idPrefix}-${role.value}`}
                    value={role.value}
                    defaultChecked={role.value === defaultRole || (!defaultRole && i === 0)}
                  />
                  <label class="btn btn-outline-secondary btn-sm" htmlFor={`role-${idPrefix}-${role.value}`}>
                    {role.label}
                  </label>
                </>
              ))}
            </div>
          </div>
        )}
        <div class="col-12">
          <label class="form-label">
            Profile links <OptionalHint />
          </label>
          <div>
            <ProfileLinksInput ref={linksRef} fieldName={linksFieldName} />
          </div>
        </div>
      </div>
    </div>
  );
}
