/**
 * AI-powered report generator using OpenAI
 * Enhances incident reports with professional writing and formatting
 */

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

interface AIEnhancedReport {
  summary: string;
  executiveSummary: string;
  detailedDescription: string;
  rootCauseAnalysis: string;
  recommendations: string;
  preventativeMeasures: string;
}

export async function generateAIEnhancedReport(
  incident: IncidentData,
  customTemplate?: string
): Promise<AIEnhancedReport> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  
  if (!apiKey) {
    console.warn('OpenAI API key not found, using original content without AI enhancement');
    return {
      summary: incident.incident_description || 'No summary available',
      executiveSummary: incident.incident_description || 'No executive summary available',
      detailedDescription: incident.incident_description || 'No description available',
      rootCauseAnalysis: incident.root_cause || 'Root cause analysis pending',
      recommendations: 'Recommendations pending',
      preventativeMeasures: 'Preventative measures pending',
    };
  }

  const systemPrompt = customTemplate || `You are a professional incident report writer for a perforating gun manufacturing and field service company. 
Your task is to transform raw incident data into a professional, well-structured incident report suitable for both internal review and customer communication.

Key requirements:
- Use professional, clear, and concise language
- Organize information logically with proper structure
- Highlight critical safety and operational concerns
- Provide actionable recommendations
- Maintain technical accuracy while being readable
- Focus on facts and avoid speculation
- Use industry-standard terminology for oil & gas field services
- Be objective and solution-oriented`;

  const userPrompt = `Please analyze the following incident data and create a comprehensive, professional incident report.

INCIDENT DATA:
Event ID: ${incident.event_id}
Date: ${incident.date_incident}
Severity: ${incident.incident_severity}
Status: ${incident.incident_status}
Category: ${incident.event_category}

LOCATION & CUSTOMER:
Customer: ${incident.customerName?.customer || 'N/A'}
District: ${incident.districtName?.customer_district || 'N/A'}
Operating Company: ${incident.operating_company || 'N/A'}
Field/Facility: ${incident.field_facility}
Well Name: ${incident.well_name || 'N/A'}
Stage: ${incident['stage#'] || 'N/A'}

PRODUCT INFORMATION:
Product Line: ${incident.product_line}
Firing System: ${incident.firing_system || 'N/A'}
Failed Component: ${incident.failed_component || 'N/A'}
Failure Type: ${incident.failure_type || 'N/A'}

INCIDENT DESCRIPTION:
${incident.incident_description}

INVESTIGATION NOTES:
${incident.investigation || 'Investigation in progress'}

ROOT CAUSE (if available):
${incident.root_cause || 'Root cause analysis pending'}

ADDITIONAL NOTES:
${incident.notes || 'None'}

RESPONSIBILITY:
XC Caused: ${incident.xc_caused}
Vendor Caused: ${incident.vendor_caused || 'N/A'}
Vendor: ${incident.vendor || 'N/A'}

PERSONNEL:
XC Rep (SQM): ${incident.xc_rep || 'N/A'}
Customer Rep: ${incident.customer_rep || 'N/A'}
EP Rep: ${incident.ep_rep || 'N/A'}

Please provide:
1. A concise executive summary (2-3 sentences)
2. A brief incident summary (1 paragraph)
3. A detailed description of what occurred (2-3 paragraphs)
4. A comprehensive root cause analysis (1-2 paragraphs)
5. Specific recommendations for corrective actions (bullet points)
6. Preventative measures to avoid recurrence (bullet points)

Format your response as JSON with the following structure:
{
  "summary": "brief one-paragraph summary",
  "executiveSummary": "2-3 sentence executive summary",
  "detailedDescription": "detailed multi-paragraph description",
  "rootCauseAnalysis": "comprehensive root cause analysis",
  "recommendations": "bulleted list of recommendations",
  "preventativeMeasures": "bulleted list of preventative measures"
}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API Error:', errorText);
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    const enhancedReport = JSON.parse(content);

    return enhancedReport;
  } catch (error) {
    console.error('Error generating AI-enhanced report:', error);
    
    // Fallback to original content if AI fails
    return {
      summary: incident.incident_description || 'No summary available',
      executiveSummary: incident.incident_description || 'No executive summary available',
      detailedDescription: incident.incident_description || 'No description available',
      rootCauseAnalysis: incident.root_cause || 'Root cause analysis pending',
      recommendations: 'Recommendations pending - AI enhancement failed',
      preventativeMeasures: 'Preventative measures pending - AI enhancement failed',
    };
  }
}
