/**
 * Network helper for the incident report PDF pipeline.
 *
 * Fetches the images attached to an incident (from the `/images/incidents/:row_id`
 * edge route — same source the picker uses) and returns them already shaped as
 * the `IncidentReportImage[]` the PDF generator expects, with every image
 * selected and a sensible default caption.
 *
 * This is what lets flows that DON'T show the picker (e.g. "Send to Customer")
 * still capture NATIVE / backfilled AppSheet images instead of silently falling
 * back to the empty legacy `image1` / `image2` incident columns.
 *
 * Kept out of `incidentPdfImages.ts` so that file stays DOM/network-free and
 * unit-testable.
 */
import { getBearerToken } from './authHeaders';
import {
  buildDefaultSelection,
  selectionToPdfImages,
  type IncidentReportImage,
  type PickerImageRecord,
} from './incidentPdfImages';

/**
 * Fetch an incident's images and return them auto-selected for the PDF.
 *
 * Returns an empty array (never throws) on any failure so callers can safely
 * fall back to legacy behaviour — generating the report without crashing the
 * send flow if the image service is briefly unavailable.
 */
export async function fetchIncidentReportImages(
  baseUrl: string,
  incidentRowId: string,
): Promise<IncidentReportImage[]> {
  if (!incidentRowId) return [];
  try {
    const url = `${baseUrl}/images/incidents/${encodeURIComponent(incidentRowId)}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${await getBearerToken()}` },
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const files: PickerImageRecord[] = Array.isArray(data?.files) ? data.files : [];
    if (files.length === 0) return [];
    const selection = buildDefaultSelection(files);
    return selectionToPdfImages(files, selection);
  } catch {
    return [];
  }
}
