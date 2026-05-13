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
    throw new Error(`RecruitCRM error ${res.status}: ${text}`);
  }
  return res.json();
}

function createServer() {
  const server = new McpServer({ name: "RecruitCRM", version: "1.0.0" });

  server.tool("search_candidates",
    "Search for candidates by name, skills, location or any keyword",
    {
      query: z.string().optional().describe("Search keyword e.g. 'JavaScript London'"),
      page: z.number().optional().describe("Page number, default 1"),
    },
    async ({ query = "", page = 1 }) => {
      const params = new URLSearchParams({ page: String(page) });
      if (query) params.set("q", query);
      const data = await rcrmFetch(`/candidates/search?${params}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("get_candidate",
    "Get full profile details for a specific candidate",
    { slug: z.string().describe("The candidate slug ID from RecruitCRM") },
    async ({ slug }) => {
      const data = await rcrmFetch(`/candidates/${slug}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("search_contacts",
    "Search for contacts such as clients and hiring managers",
    {
      query: z.string().optional().describe("Search keyword"),
      page: z.number().optional().describe("Page number, default 1"),
    },
    async ({ query = "", page = 1 }) => {
      const params = new URLSearchParams({ page: String(page) });
      if (query) params.set("q", query);
      const data = await rcrmFetch(`/contacts/search?${params}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("get_contact",
    "Get full details for a specific contact",
    { slug: z.string().describe("The contact slug ID from RecruitCRM") },
    async ({ slug }) => {
      const data = await rcrmFetch(`/contacts/${slug}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("search_jobs",
    "Search for jobs in RecruitCRM",
    {
      query: z.string().optional().describe("Search keyword"),
      status: z.number().optional().describe("1=Open, 2=Closed, 3=On Hold"),
      page: z.number().optional().describe("Page number, default 1"),
    },
    async ({ query = "", status, page = 1 }) => {
      const params = new URLSearchParams({ page: String(page) });
      if (query) params.set("q", query);
      if (status !== undefined) params.set("job_status", String(status));
      const data = await rcrmFetch(`/jobs/search?${params}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("get_job",
    "Get full details for a specific job",
    { slug: z.string().describe("The job slug ID from RecruitCRM") },
    async ({ slug }) => {
      const data = await rcrmFetch(`/jobs/${slug}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("create_candidate",
    "Add a new candidate to RecruitCRM",
    {
      first_name: z.string().describe("First name"),
      last_name: z.string().describe("Last name"),
      email: z.string().optional().describe("Email address"),
      phone: z.string().optional().describe("Phone number"),
      current_title: z.string().optional().describe("Current job title"),
      current_company: z.string().optional().describe("Current employer"),
    },
    async (body) => {
      const data = await rcrmFetch("/candidates", {
        method: "POST",
        body: JSON.stringify(body),
      });
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
      phone: z.string().optional(),
      current_title: z.string().optional(),
      current_company: z.string().optional(),
      summary: z.string().optional().describe("Profile summary or notes"),
    },
    async ({ slug, ...updates }) => {
      const data = await rcrmFetch(`/candidates/${slug}`, {
        method: "PUT",
        body: JSON.stringify(updates),
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool("generate_cv",
    "Generate a nicely formatted CV for a candidate from their RecruitCRM profile",
    { slug: z.string().describe("Candidate slug ID") },
    async ({ slug }) => {
      const c = await rcrmFetch(`/candidates/${slug}`);
      const cv = `
CURRICULUM VITAE
================
${c.first_name} ${c.last_name}
${c.email || ""} | ${c.phone || ""}

CURRENT ROLE
------------
${c.current_title || "N/A"} at ${c.current_company || "N/A"}

SUMMARY
-------
${c.summary || "No summary provided"}

SKILLS
------
${(c.skill_list || []).join(", ") || "None listed"}

EXPERIENCE
----------
${(c.experiences || []).map(e =>
  `${e.title || ""} at ${e.company_name || ""} (${e.start_date || ""} - ${e.end_date || "Present"})\n${e.description || ""}`
).join("\n\n") || "None listed"}

EDUCATION
---------
${(c.educations || []).map(e =>
  `${e.degree || ""} - ${e.school_name || ""} (${e.completion_year || ""})`
).join("\n") || "None listed"}
      `.trim();
      return { content: [{ type: "text", text: cv }] };
    }
  );

  return server;
}

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

app.get("/health", (_, res) => res.json({ status: "ok", service: "RecruitCRM MCP" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`RecruitCRM MCP server running on port ${PORT}`));
