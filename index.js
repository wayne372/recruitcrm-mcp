import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";

const API_TOKEN = process.env.RECRUITCRM_API_TOKEN;
const BASE_URL = "https://api.recruitcrm.io/v1";

async function rcrmFetch(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${API_TOKEN}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    }
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`[RCRM ERROR] ${options.method || 'GET'} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
    throw new Error(`RecruitCRM error ${res.status}: ${text}`);
  }
  return res.json();
}

function createServer() {
  const server = new McpServer({
    name: "RecruitCRM",
    version: "2.0.0",
    instructions: `You are connected to a RecruitCRM account via a custom MCP integration. You have the following tools available - use them proactively without being asked:

- search_candidates / list_candidates: find or list candidates
- get_candidate: get full profile + notes + call logs for a candidate
- create_candidate / update_candidate: add or edit candidates
- parse_resume: parse a CV from a URL
- generate_cv: generate a formatted CV from a candidate profile
- search_contacts / list_contacts / get_contact: find or view contacts
- create_contact / update_contact: add or edit contacts
- search_companies / list_companies / get_company: find or view companies
- create_company / update_company: add or edit companies
- search_jobs / list_jobs / get_job: find or view jobs
- create_job / update_job: add or edit jobs
- get_my_hotlists: ALWAYS use this when the user asks about hotlists or shortlists
- create_hotlist / add_to_hotlist / remove_from_hotlist: manage hotlists
- list_notes / create_note: view or add notes
- list_call_logs / create_call_log: view or log calls
- list_tasks / create_task: view or create tasks
- list_meetings / create_meeting: view or log meetings
- get_candidate_files: get files attached to a candidate
- enroll_candidate_in_sequence / enroll_contact_in_sequence: manage sequences

Never say a tool is unavailable without trying it first. Never use update_candidate to add notes - always use create_note.`
  });

  // ================================================================
  // CANDIDATES
  // ================================================================

  server.tool("search_candidates",
    "Search or list candidates. Pass name to find a specific person e.g. 'Jamie Stalker'. Leave all empty to list all candidates.",
    {
      name: z.string().optional().describe("Full or partial candidate name e.g. 'Jamie Stalker' or just 'Jamie'"),
      email: z.string().optional().describe("Email address"),
      city: z.string().optional().describe("City or location"),
      skill: z.string().optional().describe("Skill keyword"),
      current_employer: z.string().optional().describe("Current employer/company name"),
      current_title: z.string().optional().describe("Current job title"),
      page: z.number().optional().describe("Page number, default 1"),
    },
    async ({ page = 1, name, ...filters }) => {
      const hasFilters = name || Object.values(filters).some(v => v);
      if (hasFilters) {
        const params = new URLSearchParams({ page: String(page) });
        if (name) {
          const parts = name.trim().split(/\s+/);
          params.set("first_name", parts[0]);
          if (parts.length > 1) params.set("last_name", parts.slice(1).join(" "));
        }
        Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, String(v)); });
        const data = await rcrmFetch(`/candidates/search?${params}`);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } else {
        const data = await rcrmFetch(`/candidates?page=${page}`);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
    }
  );

  server.tool("list_candidates",
    "List all candidates with pagination",
    { page: z.number().optional().describe("Page number, default 1") },
    async ({ page = 1 }) => {
      const data = await rcrmFetch(`/candidates?page=${page}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("get_candidate",
    "Get full profile, notes, and call logs for a specific candidate by their slug ID",
    { slug: z.string().describe("Candidate slug ID") },
    async ({ slug }) => {
      const [profile, notes, calls] = await Promise.all([
        rcrmFetch(`/candidates/${slug}`),
        rcrmFetch(`/notes?slug=${slug}`).catch(() => ({ data: [] })),
        rcrmFetch(`/call-logs?slug=${slug}`).catch(() => ({ data: [] })),
      ]);
      const result = {
        ...profile,
        notes: notes.data || [],
        call_logs: calls.data || [],
      };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool("create_candidate",
    "Add a new candidate to RecruitCRM",
    {
      first_name: z.string().describe("First name"),
      last_name: z.string().describe("Last name"),
      email: z.string().optional().describe("Email address"),
      contact_number: z.string().optional().describe("Phone number"),
      current_title: z.string().optional().describe("Current job title"),
      current_employer: z.string().optional().describe("Current employer name"),
      city: z.string().optional().describe("City"),
      country: z.string().optional().describe("Country"),
      summary: z.string().optional().describe("Profile summary"),
    },
    async (body) => {
      const data = await rcrmFetch("/candidates", { method: "POST", body: JSON.stringify(body) });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("update_candidate",
    "Update an existing candidate's details in RecruitCRM",
    {
      slug: z.string().describe("Candidate slug ID"),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      email: z.string().optional(),
      contact_number: z.string().optional(),
      current_title: z.string().optional(),
      current_employer: z.string().optional(),
      city: z.string().optional(),
      country: z.string().optional(),
      summary: z.string().optional(),
    },
    async ({ slug, ...updates }) => {
      const data = await rcrmFetch(`/candidates/${slug}`, { method: "POST", body: JSON.stringify(updates) });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("parse_resume",
    "Parse a CV/resume from a public URL to automatically extract candidate data. Returns structured profile information.",
    {
      resume_url: z.string().describe("Publicly accessible URL of the CV or resume file (PDF or Word)"),
    },
    async ({ resume_url }) => {
      const data = await rcrmFetch("/candidates/resume-parser", {
        method: "POST",
        body: JSON.stringify({ resume_url }),
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("get_candidate_hiring_stages",
    "Get all jobs and pipeline stages a candidate is currently in",
    { slug: z.string().describe("Candidate slug ID") },
    async ({ slug }) => {
      const data = await rcrmFetch(`/candidates/${slug}/hiring-stages`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("update_candidate_hiring_stage",
    "Move a candidate to a different pipeline stage on a specific job",
    {
      candidate_slug: z.string().describe("Candidate slug ID"),
      job_slug: z.string().describe("Job slug ID"),
      stage_id: z.number().describe("The pipeline stage ID to move the candidate to"),
    },
    async ({ candidate_slug, job_slug, stage_id }) => {
      const data = await rcrmFetch(`/candidates/${candidate_slug}/update-hiring-stage`, {
        method: "POST",
        body: JSON.stringify({ job_slug, stage_id }),
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("assign_candidate_to_job",
    "Assign a candidate to a job opening in RecruitCRM",
    {
      candidate_slug: z.string().describe("Candidate slug ID"),
      job_slug: z.string().describe("Job slug ID"),
    },
    async ({ candidate_slug, job_slug }) => {
      const data = await rcrmFetch(`/candidates/${candidate_slug}/apply`, {
        method: "POST",
        body: JSON.stringify({ job_slug }),
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("generate_cv",
    "Generate a clean formatted CV from a candidate's RecruitCRM profile",
    { slug: z.string().describe("Candidate slug ID") },
    async ({ slug }) => {
      const c = await rcrmFetch(`/candidates/${slug}`);
      const lines = [
        "CURRICULUM VITAE",
        "================",
        `${c.first_name || ""} ${c.last_name || ""}`.trim(),
        [c.email, c.contact_number].filter(Boolean).join(" | "),
        [c.city, c.country].filter(Boolean).join(", "),
        "",
        "CURRENT ROLE",
        "------------",
        `${c.current_title || "N/A"} at ${c.current_employer || "N/A"}`,
        "",
        "SUMMARY",
        "-------",
        c.summary || "No summary provided",
        "",
        "SKILLS",
        "------",
        (c.skill_list || []).join(", ") || "None listed",
        "",
        "EXPERIENCE",
        "----------",
        ...((c.experiences || []).map(e =>
          `${e.title || ""} at ${e.company_name || ""} (${e.start_date || ""} - ${e.end_date || "Present"})\n${e.description || ""}`
        )),
        "",
        "EDUCATION",
        "---------",
        ...((c.educations || []).map(e =>
          `${e.degree || ""} - ${e.school_name || ""} (${e.completion_year || ""})`
        )),
      ];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.tool("get_candidate_files",
    "Get all files attached to a candidate including CVs and formatted CVs",
    { slug: z.string().describe("Candidate slug ID") },
    async ({ slug }) => {
      const data = await rcrmFetch(`/candidates/${slug}/files`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ================================================================
  // CONTACTS
  // ================================================================

  server.tool("search_contacts",
    "Search or list contacts. Use company_name to find contacts at a specific company e.g. 'Oak Engage'. Leave empty to list all contacts.",
    {
      name: z.string().optional().describe("Contact full or partial name e.g. 'Will Murray'"),
      email: z.string().optional().describe("Email address"),
      company_name: z.string().optional().describe("Company name e.g. 'Oak Engage'"),
      city: z.string().optional().describe("City or location"),
      page: z.number().optional().describe("Page number, default 1"),
    },
    async ({ page = 1, name, ...filters }) => {
      const hasFilters = name || Object.values(filters).some(v => v);
      if (hasFilters) {
        const params = new URLSearchParams({ page: String(page) });
        if (name) {
          const parts = name.trim().split(/\s+/);
          params.set("first_name", parts[0]);
          if (parts.length > 1) params.set("last_name", parts.slice(1).join(" "));
        }
        Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, String(v)); });
        const data = await rcrmFetch(`/contacts/search?${params}`);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } else {
        const data = await rcrmFetch(`/contacts?page=${page}`);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
    }
  );

  server.tool("list_contacts",
    "List all contacts with pagination",
    { page: z.number().optional().describe("Page number, default 1") },
    async ({ page = 1 }) => {
      const data = await rcrmFetch(`/contacts?page=${page}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("get_contact",
    "Get full details, notes, and call logs for a specific contact by their slug ID",
    { slug: z.string().describe("Contact slug ID") },
    async ({ slug }) => {
      const [profile, notes, calls] = await Promise.all([
        rcrmFetch(`/contacts/${slug}`),
        rcrmFetch(`/notes?slug=${slug}`).catch(() => ({ data: [] })),
        rcrmFetch(`/call-logs?slug=${slug}`).catch(() => ({ data: [] })),
      ]);
      const result = {
        ...profile,
        notes: notes.data || [],
        call_logs: calls.data || [],
      };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool("create_contact",
    "Create a new contact (client or hiring manager) in RecruitCRM",
    {
      first_name: z.string().describe("First name"),
      last_name: z.string().describe("Last name"),
      email: z.string().optional().describe("Email address"),
      contact_number: z.string().optional().describe("Phone number"),
      title: z.string().optional().describe("Job title"),
      company_slug: z.string().optional().describe("Slug of the associated company"),
      city: z.string().optional().describe("City"),
      country: z.string().optional().describe("Country"),
    },
    async (body) => {
      const data = await rcrmFetch("/contacts", { method: "POST", body: JSON.stringify(body) });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("update_contact",
    "Update an existing contact's details",
    {
      slug: z.string().describe("Contact slug ID"),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      email: z.string().optional(),
      contact_number: z.string().optional(),
      title: z.string().optional(),
      city: z.string().optional(),
      country: z.string().optional(),
    },
    async ({ slug, ...updates }) => {
      const data = await rcrmFetch(`/contacts/${slug}`, { method: "POST", body: JSON.stringify(updates) });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ================================================================
  // COMPANIES
  // ================================================================

  server.tool("search_companies",
    "Search companies by name or location. At least one filter required.",
    {
      name: z.string().optional().describe("Company name"),
      city: z.string().optional().describe("City or location"),
      page: z.number().optional().describe("Page number, default 1"),
    },
    async ({ page = 1, ...filters }) => {
      const params = new URLSearchParams({ page: String(page) });
      Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, String(v)); });
      const data = await rcrmFetch(`/companies/search?${params}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("list_companies",
    "List all companies with pagination",
    { page: z.number().optional().describe("Page number, default 1") },
    async ({ page = 1 }) => {
      const data = await rcrmFetch(`/companies?page=${page}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("get_company",
    "Get full details for a specific company by its slug ID",
    { slug: z.string().describe("Company slug ID") },
    async ({ slug }) => {
      const data = await rcrmFetch(`/companies/${slug}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("create_company",
    "Create a new company in RecruitCRM",
    {
      name: z.string().describe("Company name"),
      city: z.string().optional().describe("City"),
      country: z.string().optional().describe("Country"),
      website: z.string().optional().describe("Website URL"),
      industry: z.string().optional().describe("Industry"),
    },
    async (body) => {
      const data = await rcrmFetch("/companies", { method: "POST", body: JSON.stringify(body) });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("update_company",
    "Update an existing company's details",
    {
      slug: z.string().describe("Company slug ID"),
      name: z.string().optional(),
      city: z.string().optional(),
      country: z.string().optional(),
      website: z.string().optional(),
      industry: z.string().optional(),
    },
    async ({ slug, ...updates }) => {
      const data = await rcrmFetch(`/companies/${slug}`, { method: "POST", body: JSON.stringify(updates) });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ================================================================
  // JOBS
  // ================================================================

  server.tool("search_jobs",
    "Search or list jobs. Use job_status 1 for open jobs, 2 for closed, 3 for on hold. Leave all empty to list all jobs.",
    {
      name: z.string().optional().describe("Job title keyword"),
      city: z.string().optional().describe("City or location"),
      job_status: z.number().optional().describe("1=Open, 2=Closed, 3=On Hold"),
      page: z.number().optional().describe("Page number, default 1"),
    },
    async ({ page = 1, ...filters }) => {
      const hasFilters = Object.values(filters).some(v => v !== undefined && v !== null && v !== '');
      if (hasFilters) {
        const params = new URLSearchParams({ page: String(page) });
        Object.entries(filters).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') params.set(k, String(v)); });
        const data = await rcrmFetch(`/jobs/search?${params}`);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } else {
        const data = await rcrmFetch(`/jobs?page=${page}`);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
    }
  );

  server.tool("list_jobs",
    "List all jobs with pagination",
    { page: z.number().optional().describe("Page number, default 1") },
    async ({ page = 1 }) => {
      const data = await rcrmFetch(`/jobs?page=${page}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("get_job",
    "Get full details for a specific job by its slug ID",
    { slug: z.string().describe("Job slug ID") },
    async ({ slug }) => {
      const data = await rcrmFetch(`/jobs/${slug}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("create_job",
    "Create a new job opening in RecruitCRM",
    {
      name: z.string().describe("Job title"),
      company_slug: z.string().optional().describe("Slug of the associated company"),
      city: z.string().optional().describe("Job location city"),
      country: z.string().optional().describe("Job location country"),
      description: z.string().optional().describe("Job description"),
      min_salary: z.number().optional().describe("Minimum salary"),
      max_salary: z.number().optional().describe("Maximum salary"),
    },
    async (body) => {
      const data = await rcrmFetch("/jobs", { method: "POST", body: JSON.stringify(body) });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("update_job",
    "Update an existing job's details or status",
    {
      slug: z.string().describe("Job slug ID"),
      name: z.string().optional(),
      city: z.string().optional(),
      country: z.string().optional(),
      description: z.string().optional(),
      job_status: z.number().optional().describe("1=Open, 2=Closed, 3=On Hold"),
    },
    async ({ slug, ...updates }) => {
      const data = await rcrmFetch(`/jobs/${slug}`, { method: "POST", body: JSON.stringify(updates) });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("get_job_candidates",
    "Get all candidates assigned to a job and their current pipeline stages",
    { slug: z.string().describe("Job slug ID") },
    async ({ slug }) => {
      const data = await rcrmFetch(`/jobs/${slug}/candidates`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("get_job_hiring_stages",
    "Get the available pipeline stages for a specific job",
    { slug: z.string().describe("Job slug ID") },
    async ({ slug }) => {
      const data = await rcrmFetch(`/jobs/${slug}/hiring-stages`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ================================================================
  // CALL LOGS
  // ================================================================

  server.tool("list_call_logs",
    "IMPORTANT: Use this tool (not get_candidate) whenever asked about calls or call history for a person. Pass candidate_slug to filter by candidate.",
    {
      candidate_slug: z.string().optional().describe("Filter calls for a specific candidate"),
      contact_slug: z.string().optional().describe("Filter calls for a specific contact"),
      job_slug: z.string().optional().describe("Filter calls for a specific job"),
      page: z.number().optional().describe("Page number, default 1"),
    },
    async ({ page = 1, candidate_slug, contact_slug, job_slug }) => {
      const params = new URLSearchParams({ page: String(page) });
      if (candidate_slug) params.set("slug", candidate_slug);
      else if (contact_slug) params.set("slug", contact_slug);
      else if (job_slug) params.set("slug", job_slug);
      const data = await rcrmFetch(`/call-logs?${params}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("create_call_log",
    "IMPORTANT: Use this tool (not update_candidate) whenever asked to log or create a call record.",
    {
      candidate_slug: z.string().optional().describe("Candidate slug (if the call was with a candidate)"),
      contact_slug: z.string().optional().describe("Contact slug (if the call was with a contact)"),
      note: z.string().describe("Summary or notes from the call"),
      duration: z.number().optional().describe("Call duration in seconds"),
      call_type: z.string().optional().describe("Call type e.g. outbound, inbound"),
    },
    async (body) => {
      const data = await rcrmFetch("/call-logs", { method: "POST", body: JSON.stringify(body) });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ================================================================
  // NOTES
  // ================================================================

  server.tool("list_notes",
    "IMPORTANT: Use this tool (not get_candidate) whenever asked about notes or activity on a record. Pass candidate_slug to get notes for a specific candidate.",
    {
      candidate_slug: z.string().optional().describe("Filter notes for a specific candidate"),
      contact_slug: z.string().optional().describe("Filter notes for a specific contact"),
      job_slug: z.string().optional().describe("Filter notes for a specific job"),
      page: z.number().optional().describe("Page number, default 1"),
    },
    async ({ page = 1, candidate_slug, contact_slug, job_slug }) => {
      const params = new URLSearchParams({ page: String(page) });
      if (candidate_slug) params.set("slug", candidate_slug);
      else if (contact_slug) params.set("slug", contact_slug);
      else if (job_slug) params.set("slug", job_slug);
      const data = await rcrmFetch(`/notes?${params}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("create_note",
    "IMPORTANT: Use this tool (not update_candidate) whenever asked to add or create a note. Never use update_candidate for notes.",
    {
      note: z.string().describe("Note content"),
      candidate_slug: z.string().optional().describe("Candidate slug to attach the note to"),
      contact_slug: z.string().optional().describe("Contact slug to attach the note to"),
      job_slug: z.string().optional().describe("Job slug to attach the note to"),
    },
    async ({ note, candidate_slug, contact_slug, job_slug }) => {
      let related_to_type = null;
      let related_to = null;
      if (candidate_slug) { related_to_type = "candidate"; related_to = candidate_slug; }
      else if (contact_slug) { related_to_type = "contact"; related_to = contact_slug; }
      else if (job_slug) { related_to_type = "job"; related_to = job_slug; }
      const body = {
        description: note,
        related_to_type,
        related_to,
        candidate_slug,
        contact_slug,
        job_slug,
      };
      const data = await rcrmFetch("/notes", { method: "POST", body: JSON.stringify(body) });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ================================================================
  // TASKS
  // ================================================================

  server.tool("list_tasks",
    "List all tasks with pagination",
    { page: z.number().optional().describe("Page number, default 1") },
    async ({ page = 1 }) => {
      const data = await rcrmFetch(`/tasks?page=${page}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("search_tasks",
    "Search tasks by associated candidate, contact or job",
    {
      candidate_slug: z.string().optional().describe("Filter by candidate slug"),
      contact_slug: z.string().optional().describe("Filter by contact slug"),
      page: z.number().optional().describe("Page number, default 1"),
    },
    async ({ page = 1, ...filters }) => {
      const params = new URLSearchParams({ page: String(page) });
      Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, String(v)); });
      const data = await rcrmFetch(`/tasks/search?${params}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("create_task",
    "Create a new task in RecruitCRM",
    {
      name: z.string().describe("Task title"),
      due_date: z.string().optional().describe("Due date in YYYY-MM-DD format"),
      description: z.string().optional().describe("Task description or details"),
      candidate_slug: z.string().optional().describe("Associate with a candidate"),
      contact_slug: z.string().optional().describe("Associate with a contact"),
      job_slug: z.string().optional().describe("Associate with a job"),
    },
    async (body) => {
      const data = await rcrmFetch("/tasks", { method: "POST", body: JSON.stringify(body) });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ================================================================
  // MEETINGS
  // ================================================================

  server.tool("list_meetings",
    "List all meetings with pagination",
    { page: z.number().optional().describe("Page number, default 1") },
    async ({ page = 1 }) => {
      const data = await rcrmFetch(`/meetings?page=${page}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("search_meetings",
    "Search meetings by associated candidate or contact",
    {
      candidate_slug: z.string().optional().describe("Filter by candidate slug"),
      contact_slug: z.string().optional().describe("Filter by contact slug"),
      page: z.number().optional().describe("Page number, default 1"),
    },
    async ({ page = 1, ...filters }) => {
      const params = new URLSearchParams({ page: String(page) });
      Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, String(v)); });
      const data = await rcrmFetch(`/meetings/search?${params}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("create_meeting",
    "Log or schedule a meeting in RecruitCRM",
    {
      title: z.string().describe("Meeting title"),
      meeting_date: z.string().describe("Meeting date and time in YYYY-MM-DD HH:MM format"),
      candidate_slug: z.string().optional().describe("Associate with a candidate"),
      contact_slug: z.string().optional().describe("Associate with a contact"),
      description: z.string().optional().describe("Meeting notes, agenda or summary"),
    },
    async (body) => {
      const data = await rcrmFetch("/meetings", { method: "POST", body: JSON.stringify(body) });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ================================================================
  // HOTLISTS
  // ================================================================

  server.tool("get_my_hotlists",
    "Returns all hotlists. Call this tool for any request about hotlists, shortlists or saved candidate lists.",
    { page: z.number().optional().describe("Page number, default 1") },
    async ({ page = 1 }) => {
      const data = await rcrmFetch(`/hotlists?page=${page}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("search_hotlists",
    "Search for hotlists by name",
    {
      name: z.string().optional().describe("Hotlist name keyword"),
      page: z.number().optional().describe("Page number, default 1"),
    },
    async ({ page = 1, ...filters }) => {
      const params = new URLSearchParams({ page: String(page) });
      Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, String(v)); });
      const data = await rcrmFetch(`/hotlists/search?${params}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("create_hotlist",
    "Create a new hotlist in RecruitCRM",
    {
      name: z.string().describe("Hotlist name"),
      description: z.string().optional().describe("Hotlist description"),
    },
    async (body) => {
      const data = await rcrmFetch("/hotlists", { method: "POST", body: JSON.stringify(body) });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("add_to_hotlist",
    "Add a candidate or contact to a hotlist",
    {
      hotlist_id: z.string().describe("Hotlist ID"),
      candidate_slug: z.string().optional().describe("Candidate slug to add"),
      contact_slug: z.string().optional().describe("Contact slug to add"),
    },
    async ({ hotlist_id, ...body }) => {
      const data = await rcrmFetch(`/hotlists/${hotlist_id}/add`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("remove_from_hotlist",
    "Remove a candidate or contact from a hotlist",
    {
      hotlist_id: z.string().describe("Hotlist ID"),
      candidate_slug: z.string().optional().describe("Candidate slug to remove"),
      contact_slug: z.string().optional().describe("Contact slug to remove"),
    },
    async ({ hotlist_id, ...body }) => {
      const data = await rcrmFetch(`/hotlists/${hotlist_id}/remove`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ================================================================
  // SEQUENCES
  // ================================================================

  server.tool("search_sequences",
    "Search available sequences and automations in RecruitCRM",
    { page: z.number().optional().describe("Page number, default 1") },
    async ({ page = 1 }) => {
      const data = await rcrmFetch(`/sequences/search?page=${page}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("enroll_candidate_in_sequence",
    "Enroll a candidate into an automated sequence",
    {
      candidate_slug: z.string().describe("Candidate slug ID"),
      sequence_id: z.string().describe("Sequence ID to enroll into"),
    },
    async (body) => {
      const data = await rcrmFetch("/sequences/enroll-candidate", {
        method: "POST",
        body: JSON.stringify(body),
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("unenroll_candidate_from_sequence",
    "Remove a candidate from an automated sequence",
    {
      candidate_slug: z.string().describe("Candidate slug ID"),
      sequence_id: z.string().describe("Sequence ID to unenroll from"),
    },
    async (body) => {
      const data = await rcrmFetch("/sequences/unenroll-candidate", {
        method: "POST",
        body: JSON.stringify(body),
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("enroll_contact_in_sequence",
    "Enroll a contact into an automated sequence",
    {
      contact_slug: z.string().describe("Contact slug ID"),
      sequence_id: z.string().describe("Sequence ID to enroll into"),
    },
    async (body) => {
      const data = await rcrmFetch("/sequences/enroll-contact", {
        method: "POST",
        body: JSON.stringify(body),
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("unenroll_contact_from_sequence",
    "Remove a contact from an automated sequence",
    {
      contact_slug: z.string().describe("Contact slug ID"),
      sequence_id: z.string().describe("Sequence ID to unenroll from"),
    },
    async (body) => {
      const data = await rcrmFetch("/sequences/unenroll-contact", {
        method: "POST",
        body: JSON.stringify(body),
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  return server;
}

// ================================================================
// SERVER SETUP
// ================================================================

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = createServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("finish", () => server.close());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

app.get("/health", (_, res) => res.json({
  status: "ok",
  service: "RecruitCRM MCP",
  version: "2.0.0",
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`RecruitCRM MCP v2.0 running on port ${PORT}`));

// ================================================================
// DIAGNOSTIC ENDPOINT
// ================================================================
app.get("/test", async (req, res) => {
  const results = {};

  // Get first call log to see its data structure
  try {
    const r = await fetch(`${BASE_URL}/call-logs?page=1`, {
      headers: { "Authorization": `Bearer ${API_TOKEN}`, "Accept": "application/json" }
    });
    const json = await r.json();
    results["call_log_sample"] = json.data?.[0] || "no data";
  } catch(e) { results["call_log_sample"] = String(e); }

  // Get first note to see its data structure
  try {
    const r = await fetch(`${BASE_URL}/notes?page=1`, {
      headers: { "Authorization": `Bearer ${API_TOKEN}`, "Accept": "application/json" }
    });
    const json = await r.json();
    results["note_sample"] = json.data?.[0] || "no data";
  } catch(e) { results["note_sample"] = String(e); }

  // Try sequence paths
  const seqPaths = ["/sequences", "/sequence", "/enrollments", "/candidate-sequences"];
  for (const p of seqPaths) {
    try {
      const r = await fetch(`${BASE_URL}${p}?page=1`, {
        headers: { "Authorization": `Bearer ${API_TOKEN}`, "Accept": "application/json" }
      });
      results["seq: " + p] = { status: r.status };
    } catch(e) { results["seq: " + p] = String(e); }
  }

  res.json(results);
});


