import "./headshot-dialogs.css";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { Field } from "../ui/Field";
import { TextInput } from "../ui/TextControl";

/** Native dialog templates mounted by the shared headshot upload and crop controllers. */
export function HeadshotDialogTemplates() {
  return (
    <>
      <template id="headshot-disclaimer-template">
        <dialog id="headshot-disclaimer-modal" class="pk hsd-dialog" aria-labelledby="headshot-disclaimer-title">
          <h2 id="headshot-disclaimer-title" class="hsd-title">
            Before you upload a photo
          </h2>
          <ul class="hsd-list" />
          <form class="hsd-form" noValidate>
            <Checkbox data-headshot-agreement class="hsd-agree-row" label="I confirm all of the above." />
            <div class="hsd-actions">
              <Button type="submit" variant="primary" class="hsd-confirm" disabled>
                Upload photo
              </Button>
              <Button type="button" variant="secondary" class="hsd-cancel">
                Cancel
              </Button>
            </div>
          </form>
        </dialog>
      </template>
      <template id="crop-headshot-template">
        <dialog id="crop-headshot-modal" class="pk crop-headshot-dialog" aria-labelledby="crop-headshot-title">
          <h2 id="crop-headshot-title" class="crop-headshot-title">
            Crop headshot
          </h2>
          <p id="crop-headshot-help" class="crop-headshot-help">
            Drag the photo or use the arrow keys to position it. Zoom in to crop more closely.
          </p>
          <div
            class="crop-headshot-viewport"
            tabIndex={0}
            role="group"
            aria-label="Position photo"
            aria-describedby="crop-headshot-help"
          >
            <canvas width={1024} height={1024} role="img" aria-label="Headshot crop preview" />
          </div>
          <div class="crop-headshot-zoom">
            <Field label="Zoom image">
              {(control) => <TextInput {...control} type="range" min="0" max="100" class="crop-headshot-slider" />}
            </Field>
          </div>
          <div class="crop-headshot-actions">
            <Button type="button" variant="secondary" class="crop-headshot-cancel">
              Cancel
            </Button>
            <Button type="button" variant="primary" class="crop-headshot-confirm">
              Crop and upload
            </Button>
          </div>
        </dialog>
      </template>
    </>
  );
}
