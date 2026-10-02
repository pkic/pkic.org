import { selfAssessmentRelease } from "../../shared/self-assessment-releases";

function showUnavailable(root: HTMLElement): void {
  const message = document.createElement("p");
  message.setAttribute("role", "alert");
  message.textContent = "The assessment could not be loaded. Please reload this page to try again.";
  root.replaceChildren(message);
}

function installAssessment(root: HTMLElement): void {
  if (root.dataset.initialized === "true") return;
  root.dataset.initialized = "true";
  const version = root.dataset.version;
  const release = selfAssessmentRelease(version);
  if (!version || !release) {
    showUnavailable(root);
    return;
  }

  const assessment = document.createElement("self-assessment");
  const dataUrl = root.dataset.dataUrl;
  const configUrl = root.dataset.configUrl;
  if (dataUrl) assessment.setAttribute("dataUrl", dataUrl);
  if (configUrl) assessment.setAttribute("configUrl", configUrl);
  root.replaceChildren(assessment);

  if (document.querySelector<HTMLScriptElement>(`script[data-self-assessment-script="${version}"]`)) return;

  const script = document.createElement("script");
  script.src = release.url;
  script.integrity = release.integrity;
  script.crossOrigin = "anonymous";
  script.defer = true;
  script.dataset.selfAssessmentScript = version;
  script.addEventListener("error", () => showUnavailable(root), { once: true });
  document.head.append(script);
}

document.querySelectorAll<HTMLElement>("[data-self-assessment]").forEach(installAssessment);
