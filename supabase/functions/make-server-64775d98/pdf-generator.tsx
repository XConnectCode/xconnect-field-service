import PDFDocument from 'npm:pdfkit';
import { createClient } from 'npm:@supabase/supabase-js@2.49.2';
import { Buffer } from 'node:buffer';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

interface IncidentData {
  event_id: string;
  date_incident: string;
  incident_status: string;
  incident_severity: string;
  field_facility: string;
  notes?: string;
  customer_rep?: string;
  ep_rep?: string;
  well_name?: string;
  'stage#'?: number;
  xc_district?: string;
  product_line: string;
  firing_system?: string;
  xc_caused: string;
  event_category: string;
  vendor_caused?: string;
  'so#'?: string;
  incident_description: string;
  investigation?: string;
  root_cause?: string;
  xc_rep?: string;
  operating_company?: string;
  vendor?: string;
  failed_component?: string;
  failure_type?: string;
  customerName?: any;
  districtName?: any;
}

export async function generateIncidentReportPDF(incidentId: string): Promise<string> {
  // Fetch incident data
  const { data: incident, error: incidentError } = await supabase
    .from('incidents')
    .select(`
      *,
      customerName:customer(customer),
      districtName:customer_district(customer_district)
    `)
    .eq('row_id', incidentId)
    .single();

  if (incidentError || !incident) {
    throw new Error(`Failed to fetch incident: ${incidentError?.message}`);
  }

  // Fetch incident images
  const { data: images } = await supabase
    .from('incident_images')
    .select('*')
    .eq('incident_id', incident.event_id)
    .order('uploaded_at');

  // Create PDF
  const pdfDoc = new PDFDocument({ 
    size: 'LETTER',
    margins: { top: 50, bottom: 50, left: 50, right: 50 }
  });

  const chunks: Uint8Array[] = [];
  
  pdfDoc.on('data', (chunk: Uint8Array) => chunks.push(chunk));
  
  const pdfPromise = new Promise<Buffer>((resolve, reject) => {
    pdfDoc.on('end', () => {
      const buffer = Buffer.concat(chunks);
      resolve(buffer);
    });
    pdfDoc.on('error', reject);
  });

  // Generate PDF content
  generatePDFContent(pdfDoc, incident, images || []);
  
  pdfDoc.end();

  const pdfBuffer = await pdfPromise;

  // Upload to Supabase Storage
  const fileName = `incident-${incident.event_id}-${Date.now()}.pdf`;
  const bucketName = 'make-64775d98-incident-reports';

  // Ensure bucket exists
  const { data: buckets } = await supabase.storage.listBuckets();
  const bucketExists = buckets?.some(bucket => bucket.name === bucketName);
  
  if (!bucketExists) {
    await supabase.storage.createBucket(bucketName, {
      public: false,
      fileSizeLimit: 10485760 // 10MB
    });
  }

  // Upload PDF
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(bucketName)
    .upload(fileName, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

  if (uploadError) {
    throw new Error(`Failed to upload PDF: ${uploadError.message}`);
  }

  // Generate signed URL (valid for 1 year)
  const { data: urlData } = await supabase.storage
    .from(bucketName)
    .createSignedUrl(fileName, 31536000); // 1 year in seconds

  if (!urlData?.signedUrl) {
    throw new Error('Failed to generate signed URL');
  }

  // Update incident with PDF URL
  await supabase
    .from('incidents')
    .update({ incident_report: urlData.signedUrl })
    .eq('row_id', incidentId);

  return urlData.signedUrl;
}

function generatePDFContent(
  doc: PDFDocument, 
  incident: IncidentData, 
  images: any[]
) {
  const pageWidth = 612;
  const margin = 50;
  const contentWidth = pageWidth - (margin * 2);

  // Header with company branding
  doc.fontSize(24)
     .fillColor('#1e40af')
     .text('INCIDENT REPORT', { align: 'center' });

  doc.moveDown(0.5);
  doc.fontSize(10)
     .fillColor('#666666')
     .text('Confidential - Internal Use Only', { align: 'center' });

  doc.moveDown(1);

  // Event ID and Date
  doc.fontSize(16)
     .fillColor('#000000')
     .text(`Event ID: ${incident.event_id}`);

  doc.fontSize(12)
     .fillColor('#666666')
     .text(`Report Generated: ${new Date().toLocaleDateString('en-US', { 
       year: 'numeric', 
       month: 'long', 
       day: 'numeric',
       hour: '2-digit',
       minute: '2-digit'
     })}`);

  doc.moveDown(1);

  // SECTION 1: INCIDENT SUMMARY
  addSection(doc, 'INCIDENT SUMMARY');
  
  addKeyValue(doc, 'Incident Date', new Date(incident.date_incident).toLocaleDateString());
  addKeyValue(doc, 'Status', incident.incident_status);
  addKeyValue(doc, 'Severity', incident.incident_severity);
  addKeyValue(doc, 'Category', incident.event_category);
  addKeyValue(doc, 'SO #', incident['so#'] || 'N/A');

  doc.moveDown(1);

  // SECTION 2: LOCATION & CUSTOMER INFORMATION
  addSection(doc, 'LOCATION & CUSTOMER INFORMATION');

  addKeyValue(doc, 'Customer', incident.customerName?.customer || 'N/A');
  addKeyValue(doc, 'District', incident.districtName?.customer_district || 'N/A');
  addKeyValue(doc, 'Operating Company', incident.operating_company || 'N/A');
  addKeyValue(doc, 'Field/Facility', incident.field_facility);
  addKeyValue(doc, 'Well Name', incident.well_name || 'N/A');
  addKeyValue(doc, 'Stage #', incident['stage#']?.toString() || 'N/A');
  addKeyValue(doc, 'XC District', incident.xc_district || 'N/A');

  doc.moveDown(1);

  // SECTION 3: PRODUCT INFORMATION
  addSection(doc, 'PRODUCT INFORMATION');

  addKeyValue(doc, 'Product Line', incident.product_line);
  addKeyValue(doc, 'Firing System', incident.firing_system || 'N/A');
  addKeyValue(doc, 'Failed Component', incident.failed_component || 'N/A');
  addKeyValue(doc, 'Failure Type', incident.failure_type || 'N/A');

  doc.moveDown(1);

  // SECTION 4: RESPONSIBILITY
  addSection(doc, 'RESPONSIBILITY');

  addKeyValue(doc, 'XC Caused', incident.xc_caused);
  addKeyValue(doc, 'Vendor Caused', incident.vendor_caused || 'N/A');
  addKeyValue(doc, 'Vendor', incident.vendor || 'N/A');

  doc.moveDown(1);

  // SECTION 5: PERSONNEL
  addSection(doc, 'PERSONNEL INVOLVED');

  addKeyValue(doc, 'XC Rep (SQM)', incident.xc_rep || 'N/A');
  addKeyValue(doc, 'Customer Rep', incident.customer_rep || 'N/A');
  addKeyValue(doc, 'EP Rep', incident.ep_rep || 'N/A');

  doc.moveDown(1);

  // SECTION 6: INCIDENT DESCRIPTION
  addSection(doc, 'INCIDENT DESCRIPTION');
  doc.fontSize(10)
     .fillColor('#333333')
     .text(incident.incident_description, { align: 'left' });

  doc.moveDown(1);

  // SECTION 7: INVESTIGATION
  if (incident.investigation) {
    addSection(doc, 'INVESTIGATION');
    doc.fontSize(10)
       .fillColor('#333333')
       .text(incident.investigation, { align: 'left' });
    doc.moveDown(1);
  }

  // SECTION 8: ROOT CAUSE
  if (incident.root_cause) {
    addSection(doc, 'ROOT CAUSE ANALYSIS');
    doc.fontSize(10)
       .fillColor('#333333')
       .text(incident.root_cause, { align: 'left' });
    doc.moveDown(1);
  }

  // SECTION 9: ADDITIONAL NOTES
  if (incident.notes) {
    addSection(doc, 'ADDITIONAL NOTES');
    doc.fontSize(10)
       .fillColor('#333333')
       .text(incident.notes, { align: 'left' });
    doc.moveDown(1);
  }

  // SECTION 10: IMAGES
  if (images.length > 0) {
    addSection(doc, `INCIDENT IMAGES (${images.length})`);

    doc.fontSize(10)
       .fillColor('#666666')
       .text('Images are stored separately and can be accessed via the incident management system.');
    
    doc.moveDown(0.5);

    images.forEach((img, index) => {
      doc.fontSize(9)
         .fillColor('#333333')
         .text(`${index + 1}. Image uploaded: ${new Date(img.uploaded_at).toLocaleString()}`);
    });
  }
}

function addSection(doc: PDFDocument, title: string) {
  doc.fontSize(14)
     .fillColor('#1e40af')
     .text(title);
  doc.moveDown(0.3);
}

function addKeyValue(doc: PDFDocument, label: string, value: string) {
  doc.fontSize(10)
     .fillColor('#333333')
     .font('Helvetica-Bold')
     .text(label + ': ', { continued: true })
     .font('Helvetica')
     .fillColor('#000000')
     .text(value);
}