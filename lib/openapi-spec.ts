// OpenAPI 3.1 contract for the public API — rendered by Scalar at
// /admin/api-keys/docs. Keep in sync with docs/api.md, the Postman collection
// route, and the implementations. Hand-authored on purpose: at this size a
// generator pipeline would be more machinery than value.

const ERROR_SCHEMA = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "string",
      description: "Human-readable message describing what went wrong.",
    },
  },
} as const;

const TICKET_SUMMARY_SCHEMA = {
  type: "object",
  required: [
    "id",
    "ticketNumber",
    "subject",
    "status",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    id: {
      type: "string",
      description: "Ticket id (cuid2). Use it for the other ticket endpoints.",
      examples: ["cku1a2b3c4d5e6f"],
    },
    ticketNumber: {
      type: "integer",
      description: "Human-friendly sequential number, as shown to agents.",
      examples: [1042],
    },
    subject: { type: "string", examples: ["Cannot log in"] },
    status: {
      type: "string",
      description:
        "Status slug. The set is deployment-specific and admin-configurable — resolve labels via `GET /api/v1/config` instead of hardcoding.",
      examples: ["in_progress"],
    },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

/** Build the OpenAPI document with this instance's own base URL as the default
 * server — same pattern as the Postman collection route. */
export function buildOpenApiSpec(baseUrl: string): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "Docket API",
      version: "1.0.0",
      summary: "Create and look up support tickets from your own backend.",
      description: [
        "Docket exposes a small REST API so your own website's backend can create tickets without sending customers through the customer portal form.",
        "",
        "This is a **server-to-server** API: your backend calls it with a secret API key. Don't call it directly from a customer's browser — the key would be exposed to anyone who opens your page's network tab.",
        "",
        "## Authentication",
        "",
        "Generate a key from `/admin/api-keys` (admin only). You'll see the raw key exactly once, at creation — copy it somewhere safe immediately. Docket only ever stores a hash of it; if you lose it, revoke it and create a new one. Send it as a bearer token on every request. A missing, invalid, or revoked key gets a `401`.",
        "",
        "## Rate limits",
        "",
        "Per key: **100 ticket creations/min**, **60 replies/min**, **60 status changes/min**. Read-only endpoints aren't rate-limited. A `429` means you've hit a write limit — back off and retry after a moment.",
        "",
        "## Errors",
        "",
        'Every error response is `{ "error": "<message>" }` with an appropriate HTTP status (`400` validation, `401` auth, `403` forbidden, `404` not found, `409` conflict, `429` rate limited, `500` server error).',
        "",
        "## Merged tickets",
        "",
        "Agents can merge a duplicate ticket into another ticket from the same customer. The merged ticket's id keeps working: every `/tickets/{id}/…` endpoint acts on the ticket it was merged into — reads return that ticket (compare the response's `id` with the one you requested to detect a merge), and replies and status changes land on it. Merged tickets are left out of `GET /tickets?email=`. A reply that races a merge gets a `409`; retrying it is safe and applies it to the merged ticket.",
        "",
        "## Outbound webhooks",
        "",
        "Want to be notified when a ticket is created, replied to, or closed instead of polling this API? See the [webhooks reference](/admin/webhooks/docs) — a separate contract, configured at `/admin/webhooks`.",
        "",
        "## Not supported yet",
        "",
        "A client-side/embeddable widget. See the ticket's `portalUrl` for everything else the API doesn't cover — the customer can reply and track the ticket there with zero extra work on your end.",
      ].join("\n"),
    },
    servers: [
      {
        url: baseUrl,
        description: "This Docket instance",
      },
    ],
    security: [{ apiKey: [] }],
    tags: [
      {
        name: "Configuration",
        description:
          "Deployment-specific slugs (categories, priorities, statuses). Fetch once and cache — admins can rename or reorder them at runtime.",
      },
      {
        name: "Tickets",
        description: "Create tickets and read their status and conversation.",
      },
    ],
    paths: {
      "/api/v1/config": {
        get: {
          tags: ["Configuration"],
          operationId: "getConfig",
          summary: "Get categories, priorities, statuses and tags",
          description:
            "The current valid category, priority, and status slugs, plus the shared tag pool — fetch this once (and cache it) to build a ticket form or interpret a `status` value, instead of hardcoding slugs an admin could rename or reorder later. `categories`/`priorities`/`statuses` are pre-sorted in display order (the same order agents see in the app); `tags` is alphabetical.",
          responses: {
            "200": {
              description: "Current configuration.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Config" },
                  example: {
                    categories: [{ slug: "bug", label: "Bug", color: "red" }],
                    priorities: [
                      {
                        slug: "normal",
                        label: "Normal",
                        color: "slate",
                        isDefault: true,
                      },
                    ],
                    statuses: [
                      {
                        slug: "open",
                        label: "Open",
                        color: "blue",
                        isDefault: true,
                        isClosedState: false,
                      },
                    ],
                    customFields: [
                      {
                        key: "order_id",
                        label: "Order ID",
                        type: "text",
                        required: false,
                      },
                    ],
                    tags: [{ id: "ckt1a2b3c4d5e6f", name: "billing" }],
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
      },
      "/api/v1/tickets": {
        post: {
          tags: ["Tickets"],
          operationId: "createTicket",
          summary: "Create a ticket",
          description: [
            "Create a ticket on behalf of a customer. The customer gets the standard confirmation email, which links to the returned `portalUrl` — they can reply and track the ticket there without any extra work on your end.",
            "",
            "**Editor-agnostic by design.** Ticket descriptions are rich text internally, but you don't need to speak the internal format. Send plain text (the default), or set `descriptionFormat: \"html\"` and send whatever your own editor exports (Quill, TipTap, TinyMCE, CKEditor, Lexical, Slate…). HTML is parsed strictly through Docket's own schema — any tag or attribute it doesn't recognize (scripts, event handlers, unknown elements) is simply dropped, never stored or trusted as-is.",
          ].join("\n"),
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateTicketRequest" },
                examples: {
                  plainText: {
                    summary: "Plain text (default)",
                    value: {
                      name: "Jane Doe",
                      email: "jane@example.com",
                      subject: "Cannot log in",
                      description: "I get an error when I try to sign in.",
                      category: "bug",
                    },
                  },
                  html: {
                    summary: "HTML from your own editor",
                    value: {
                      name: "Jane Doe",
                      email: "jane@example.com",
                      subject: "Cannot log in",
                      description:
                        "<p>I get an error when I try to sign in.</p><p><strong>It started this morning.</strong></p>",
                      descriptionFormat: "html",
                      category: "bug",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Ticket created.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/CreateTicketResponse" },
                  example: {
                    id: "cku1a2b3c4d5e6f",
                    ticketNumber: 1042,
                    status: "open",
                    portalUrl:
                      "https://support.example.com/ticket/cku1a2b3c4d5e6f?token=...",
                  },
                },
              },
            },
            "400": {
              description:
                "Validation failed. The message says which field: name must be 2–100 characters, email must be valid, subject 5–200 characters, description 10–5000 characters (measured after formatting is stripped), `category`/`priority` must match a configured slug, and the body must be valid JSON.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                  example: { error: "Subject must be 5–200 characters." },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "429": {
              description:
                "Rate limited — more than 100 ticket creations in a minute on this key. Back off and retry.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                  example: {
                    error: "Too many requests. Please try again later.",
                  },
                },
              },
            },
            "500": {
              description: "Unexpected server error. Nothing was created.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                  example: { error: "Failed to create ticket." },
                },
              },
            },
          },
        },
        get: {
          tags: ["Tickets"],
          operationId: "listTicketsByEmail",
          summary: "List a customer's tickets",
          description:
            'List a customer\'s tickets, most recent first — e.g. to show "Your Tickets" on your own site. Paginated: 50 per page by default, up to 100 with `per_page`. Matches on exact, case-sensitive equality against the email the ticket was created with — an empty `tickets` array just means no match, not an error. Tickets merged into another ticket are left out.',
          parameters: [
            {
              name: "email",
              in: "query",
              required: true,
              description: "Customer email the tickets were created with.",
              schema: { type: "string", format: "email" },
              example: "jane@example.com",
            },
            {
              name: "page",
              in: "query",
              required: false,
              description: "1-indexed page number. Defaults to 1.",
              schema: { type: "integer", minimum: 1, default: 1 },
              example: 1,
            },
            {
              name: "per_page",
              in: "query",
              required: false,
              description: "Results per page. Defaults to 50, max 100.",
              schema: {
                type: "integer",
                minimum: 1,
                maximum: 100,
                default: 50,
              },
              example: 50,
            },
          ],
          responses: {
            "200": {
              description: "The customer's tickets (possibly empty).",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["tickets", "pagination"],
                    properties: {
                      tickets: {
                        type: "array",
                        maxItems: 100,
                        items: { $ref: "#/components/schemas/TicketSummary" },
                      },
                      pagination: {
                        type: "object",
                        required: ["page", "perPage", "total", "totalPages"],
                        properties: {
                          page: { type: "integer" },
                          perPage: { type: "integer" },
                          total: { type: "integer" },
                          totalPages: { type: "integer" },
                        },
                      },
                    },
                  },
                  example: {
                    tickets: [
                      {
                        id: "cku1a2b3c4d5e6f",
                        ticketNumber: 1042,
                        subject: "Cannot log in",
                        status: "in_progress",
                        createdAt: "2026-07-01T10:00:00.000Z",
                        updatedAt: "2026-07-02T09:15:00.000Z",
                      },
                    ],
                    pagination: {
                      page: 1,
                      perPage: 50,
                      total: 1,
                      totalPages: 1,
                    },
                  },
                },
              },
            },
            "400": {
              description:
                "The `email` query parameter is missing, or `page`/`per_page` is invalid.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                  example: { error: "Query parameter 'email' is required." },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
      },
      "/api/v1/tickets/{id}": {
        get: {
          tags: ["Tickets"],
          operationId: "getTicket",
          summary: "Get a ticket",
          description:
            'Look up a ticket\'s full details — e.g. to show "In Progress" on your own site without redirecting to the portal, or to bind a ticket to the account that owns it. Any active API key can read any ticket on your instance; there is no per-key scoping, since a self-hosted deployment belongs to one owner. If the ticket was merged into another, that ticket is returned (its `id` differs from the one requested).',
          parameters: [{ $ref: "#/components/parameters/TicketId" }],
          responses: {
            "200": {
              description: "The ticket.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/TicketDetail" },
                  example: {
                    id: "cku1a2b3c4d5e6f",
                    ticketNumber: 1042,
                    subject: "Cannot log in",
                    status: "in_progress",
                    category: "bug",
                    priority: "normal",
                    customerName: "Jane Doe",
                    customerEmail: "jane@example.com",
                    description: "I get an error when I try to sign in.",
                    descriptionHtml:
                      "<p>I get an error when I try to sign in.</p>",
                    attachments: [],
                    customFields: { order_id: "A-1042", plan: "Pro" },
                    createdAt: "2026-07-01T10:00:00.000Z",
                    updatedAt: "2026-07-02T09:15:00.000Z",
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/api/v1/tickets/{id}/attachments/{attachmentId}": {
        get: {
          tags: ["Tickets"],
          operationId: "getTicketAttachment",
          summary: "Download an attachment",
          description:
            "Download a single attachment's bytes — e.g. to proxy a file the customer or an agent uploaded through to your own users, without exposing storage keys. Matched by attachment id, so a URL keeps working after an agent merges or splits the ticket and the file moves to another ticket. This is the endpoint every `url` field elsewhere in the API (on the ticket itself and on comments) points to.",
          parameters: [
            { $ref: "#/components/parameters/TicketId" },
            { $ref: "#/components/parameters/AttachmentId" },
          ],
          responses: {
            "200": {
              description:
                "The raw file bytes, with `Content-Type` set to the attachment's stored MIME type and `Content-Disposition: attachment`.",
              content: {
                "application/octet-stream": {
                  schema: { type: "string", format: "binary" },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": {
              description:
                "The attachment doesn't exist, doesn't belong to that ticket, or the underlying file is missing from storage.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                  example: { error: "Attachment not found." },
                },
              },
            },
          },
        },
      },
      "/api/v1/tickets/{id}/comments": {
        get: {
          tags: ["Tickets"],
          operationId: "getTicketComments",
          summary: "Get a ticket's conversation",
          description: [
            "Read the conversation thread — e.g. to show ticket replies on your own site, not just its status. Only public replies are returned; internal agent notes never are (same rule the customer portal itself enforces). Comments are ordered oldest first.",
            "",
            "Replies are stored as rich text internally — `content` is that flattened to plain text; `html` renders the same content with formatting intact, safe to insert into a page (it is generated from Docket's own stored document, not arbitrary external HTML). Use whichever fits where you're displaying it.",
          ].join("\n"),
          parameters: [{ $ref: "#/components/parameters/TicketId" }],
          responses: {
            "200": {
              description: "The public conversation, oldest first.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["comments"],
                    properties: {
                      comments: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Comment" },
                      },
                    },
                  },
                  example: {
                    comments: [
                      {
                        id: "ckv2b3c4d5e6f7g",
                        authorName: "Alex (Support)",
                        authorRole: "agent",
                        content:
                          "Thanks for reaching out — looking into this now.",
                        html: "<p>Thanks for reaching out — looking into this now.</p>",
                        attachments: [],
                        createdAt: "2026-07-01T11:30:00.000Z",
                      },
                    ],
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        post: {
          tags: ["Tickets"],
          operationId: "createTicketComment",
          summary: "Post a reply",
          description:
            "Post a reply on behalf of the ticket's customer — e.g. to let them keep replying from your own product instead of the portal link. The reply is bound to whichever email the ticket was created with: `email` must match exactly, so an integrating backend can only reply as the account that actually owns the ticket (enforcing which of *your* logged-in users maps to which ticket is your job, not ours).",
          parameters: [{ $ref: "#/components/parameters/TicketId" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateCommentRequest" },
                example: {
                  email: "jane@example.com",
                  content: "Thanks, that fixed it!",
                  contentFormat: "text",
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Reply posted.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["id"],
                    properties: {
                      id: { type: "string", description: "New comment id." },
                    },
                  },
                  example: { id: "ckx4d5e6f7g8h9i" },
                },
              },
            },
            "400": {
              description:
                "`email`/`content` missing, invalid JSON, an attachment failed validation, or the ticket is closed (reopen it first via `PATCH /tickets/:id/status`).",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                  example: { error: "Cannot reply to a closed ticket." },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": { $ref: "#/components/responses/Forbidden" },
            "404": { $ref: "#/components/responses/NotFound" },
            "429": {
              description:
                "Rate limited — more than 60 replies in a minute on this key.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                  example: {
                    error: "Too many requests. Please try again later.",
                  },
                },
              },
            },
            "500": {
              description: "Unexpected server error. Nothing was posted.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                  example: { error: "Failed to add reply." },
                },
              },
            },
          },
        },
      },
      "/api/v1/tickets/{id}/status": {
        patch: {
          tags: ["Tickets"],
          operationId: "updateTicketStatus",
          summary: "Close or reopen a ticket",
          description:
            'Close or reopen a ticket on behalf of its customer — the same action the "Close"/"Reopen" button does in the customer portal. Bound to the owner\'s email the same way replies are.',
          parameters: [{ $ref: "#/components/parameters/TicketId" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/UpdateStatusRequest" },
                example: { email: "jane@example.com", action: "close" },
              },
            },
          },
          responses: {
            "200": {
              description:
                'The resulting status slug (the platform\'s configured closed/default status). Closing sends the customer the standard "ticket closed" email.',
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["status"],
                    properties: {
                      status: {
                        type: "string",
                        description:
                          "Resolve its label via `GET /api/v1/config`.",
                      },
                    },
                  },
                  example: { status: "closed" },
                },
              },
            },
            "400": {
              description:
                "`email`/`action` missing or invalid, or the ticket is already in the requested state.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                  example: { error: "Ticket is already closed." },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": { $ref: "#/components/responses/Forbidden" },
            "404": { $ref: "#/components/responses/NotFound" },
            "429": {
              description:
                "Rate limited — more than 60 status changes in a minute on this key.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                  example: {
                    error: "Too many requests. Please try again later.",
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        apiKey: {
          type: "http",
          scheme: "bearer",
          description:
            "An API key generated at `/admin/api-keys`, e.g. `dk_live_xxxxxxxxxxxxxxxxxxxxxxxx`. Sent as `Authorization: Bearer <key>`.",
        },
      },
      parameters: {
        TicketId: {
          name: "id",
          in: "path",
          required: true,
          description:
            "The ticket id (cuid2) returned when the ticket was created.",
          schema: { type: "string" },
          example: "cku1a2b3c4d5e6f",
        },
        AttachmentId: {
          name: "attachmentId",
          in: "path",
          required: true,
          description:
            "The attachment id (cuid2), from a ticket or comment's `attachments` array.",
          schema: { type: "string" },
          example: "ckw3c4d5e6f7g8h",
        },
      },
      responses: {
        Unauthorized: {
          description: "The API key is missing, invalid, or revoked.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
              example: { error: "Invalid or revoked API key." },
            },
          },
        },
        Forbidden: {
          description:
            "The `email` in the request body doesn't match the ticket's customer email.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
              example: { error: "This ticket does not belong to that email." },
            },
          },
        },
        NotFound: {
          description: "No ticket with that id exists.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
              example: { error: "Not found." },
            },
          },
        },
      },
      schemas: {
        Error: ERROR_SCHEMA,
        TicketSummary: TICKET_SUMMARY_SCHEMA,
        Base64AttachmentInput: {
          type: "object",
          required: ["filename", "mimeType", "data"],
          properties: {
            filename: { type: "string", examples: ["screenshot.png"] },
            mimeType: {
              type: "string",
              enum: [
                "image/jpeg",
                "image/png",
                "application/pdf",
                "application/zip",
                "text/plain",
              ],
              examples: ["image/png"],
            },
            data: {
              type: "string",
              format: "byte",
              description:
                "Raw file content, base64-encoded (no `data:` URL prefix).",
              examples: ["iVBORw0KGgoAAAANSU..."],
            },
          },
        },
        CreateTicketRequest: {
          type: "object",
          required: ["name", "email", "subject", "description", "category"],
          properties: {
            name: {
              type: "string",
              minLength: 2,
              maxLength: 100,
              description: "Customer's name.",
              examples: ["Jane Doe"],
            },
            email: {
              type: "string",
              format: "email",
              description:
                "Customer's email. The confirmation email (with the portal link) goes here.",
              examples: ["jane@example.com"],
            },
            subject: {
              type: "string",
              minLength: 5,
              maxLength: 200,
              examples: ["Cannot log in"],
            },
            description: {
              type: "string",
              description:
                "The ticket body: plain text by default, or HTML when `descriptionFormat` is `html`. Length limits (10–5000) are measured on the visible text after formatting is stripped.",
              examples: ["I get an error when I try to sign in."],
            },
            descriptionFormat: {
              type: "string",
              enum: ["text", "html"],
              default: "text",
              description:
                "How to interpret `description`. With `html`, unrecognized tags and attributes are dropped during conversion — send whatever your editor exports.",
            },
            category: {
              type: "string",
              description:
                "A category slug from `GET /api/v1/config` — the set is deployment-specific, don't hardcode it.",
              examples: ["bug"],
            },
            priority: {
              type: "string",
              description:
                "Optional priority slug from `GET /api/v1/config`. Falls back to the platform's default priority when omitted.",
            },
            customFields: {
              type: "object",
              description:
                "`{ \"<key>\": <value> }` map for admin-defined custom fields (see `GET /api/v1/config`'s `customFields`). Required fields are only enforced if this object is included at all — omit it entirely to skip custom fields, so adding a required one later can't break an integration that never sends it.",
              additionalProperties: true,
              examples: [{ order_id: "A-1042", plan: "Pro" }],
            },
            attachments: {
              type: "array",
              description:
                "Up to 5 files, 10 MB each. More can be added later via `POST /tickets/:id/comments`, up to the same 5-per-ticket cap.",
              maxItems: 5,
              items: { $ref: "#/components/schemas/Base64AttachmentInput" },
            },
          },
        },
        CreateTicketResponse: {
          type: "object",
          required: ["id", "ticketNumber", "status", "portalUrl"],
          properties: {
            id: { type: "string", description: "Ticket id (cuid2)." },
            ticketNumber: { type: "integer" },
            status: {
              type: "string",
              description: "The deployment's default (initial) status slug.",
            },
            portalUrl: {
              type: "string",
              format: "uri",
              description:
                "Tokenized customer portal link for this ticket — the same link the confirmation email contains. The customer can reply and track the ticket there; no account needed.",
            },
          },
        },
        Attachment: {
          type: "object",
          required: ["id", "filename", "fileSize", "mimeType", "url"],
          properties: {
            id: { type: "string", description: "Attachment id (cuid2)." },
            filename: { type: "string", examples: ["screenshot.png"] },
            fileSize: { type: "integer", description: "Bytes." },
            mimeType: { type: "string", examples: ["image/png"] },
            url: {
              type: "string",
              format: "uri",
              description:
                "Fetch the file's bytes from `GET /tickets/:id/attachments/:attachmentId`.",
            },
          },
        },
        Comment: {
          type: "object",
          required: [
            "id",
            "authorName",
            "authorRole",
            "content",
            "html",
            "attachments",
            "createdAt",
          ],
          properties: {
            id: { type: "string", description: "Comment id (cuid2)." },
            authorName: { type: "string", examples: ["Alex (Support)"] },
            authorRole: {
              type: "string",
              enum: ["customer", "agent", "admin"],
            },
            content: {
              type: "string",
              description: "The reply flattened to plain text.",
            },
            html: {
              type: "string",
              description:
                "The same reply rendered as HTML (generated from Docket's own stored document — only tags its editor can produce ever appear).",
            },
            attachments: {
              type: "array",
              description: "Files uploaded with this specific reply.",
              items: { $ref: "#/components/schemas/Attachment" },
            },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        CreateCommentRequest: {
          type: "object",
          required: ["email", "content"],
          properties: {
            email: {
              type: "string",
              format: "email",
              description: "Must match the ticket's customer email.",
              examples: ["jane@example.com"],
            },
            content: {
              type: "string",
              description: "The reply body.",
              examples: ["Thanks, that fixed it!"],
            },
            contentFormat: {
              type: "string",
              enum: ["html", "text"],
              default: "html",
              description:
                "How to interpret `content`. Note the *opposite* default from ticket creation's `descriptionFormat`.",
            },
            attachments: {
              type: "array",
              description:
                "Same format as ticket creation, capped at 5 files *total* per ticket (existing attachments count against it).",
              items: { $ref: "#/components/schemas/Base64AttachmentInput" },
            },
          },
        },
        UpdateStatusRequest: {
          type: "object",
          required: ["email", "action"],
          properties: {
            email: {
              type: "string",
              format: "email",
              description: "Must match the ticket's customer email.",
              examples: ["jane@example.com"],
            },
            action: { type: "string", enum: ["close", "reopen"] },
          },
        },
        TicketDetail: {
          type: "object",
          required: [
            "id",
            "ticketNumber",
            "subject",
            "status",
            "category",
            "priority",
            "customerName",
            "customerEmail",
            "description",
            "descriptionHtml",
            "attachments",
            "customFields",
            "createdAt",
            "updatedAt",
          ],
          properties: {
            id: {
              type: "string",
              description:
                "Ticket id (cuid2). Use it for the other ticket endpoints.",
              examples: ["cku1a2b3c4d5e6f"],
            },
            ticketNumber: {
              type: "integer",
              description:
                "Human-friendly sequential number, as shown to agents.",
              examples: [1042],
            },
            subject: { type: "string", examples: ["Cannot log in"] },
            status: {
              type: "string",
              description:
                "Status slug. The set is deployment-specific and admin-configurable — resolve labels via `GET /api/v1/config` instead of hardcoding.",
              examples: ["in_progress"],
            },
            category: { type: "string", examples: ["bug"] },
            priority: { type: "string", examples: ["normal"] },
            customerName: { type: "string", examples: ["Jane Doe"] },
            customerEmail: {
              type: "string",
              format: "email",
              examples: ["jane@example.com"],
            },
            description: {
              type: "string",
              description:
                "The customer's opening message, flattened to plain text.",
            },
            descriptionHtml: {
              type: "string",
              description: "The same opening message rendered as HTML.",
            },
            attachments: {
              type: "array",
              description:
                "Files attached to the opening message (not to any later reply — see `GET /tickets/:id/comments` for those).",
              items: { $ref: "#/components/schemas/Attachment" },
            },
            customFields: {
              type: "object",
              description:
                '`{ "<key>": <value> }` map, values decoded to native JSON types (number/boolean/string) — matching what you\'d send on create.',
              additionalProperties: true,
              examples: [{ order_id: "A-1042", plan: "Pro" }],
            },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        Config: {
          type: "object",
          required: [
            "categories",
            "priorities",
            "statuses",
            "customFields",
            "tags",
          ],
          properties: {
            categories: {
              type: "array",
              description: "In display order.",
              items: {
                type: "object",
                required: ["slug", "label", "color"],
                properties: {
                  slug: { type: "string", examples: ["bug"] },
                  label: { type: "string", examples: ["Bug"] },
                  color: { type: "string", examples: ["red"] },
                },
              },
            },
            priorities: {
              type: "array",
              description: "In display order.",
              items: {
                type: "object",
                required: ["slug", "label", "color", "isDefault"],
                properties: {
                  slug: { type: "string", examples: ["normal"] },
                  label: { type: "string", examples: ["Normal"] },
                  color: { type: "string", examples: ["slate"] },
                  isDefault: {
                    type: "boolean",
                    description:
                      "Used when a ticket is created without an explicit priority.",
                  },
                },
              },
            },
            statuses: {
              type: "array",
              description: "In display order.",
              items: {
                type: "object",
                required: [
                  "slug",
                  "label",
                  "color",
                  "isDefault",
                  "isClosedState",
                ],
                properties: {
                  slug: { type: "string", examples: ["open"] },
                  label: { type: "string", examples: ["Open"] },
                  color: { type: "string", examples: ["blue"] },
                  isDefault: {
                    type: "boolean",
                    description: "The status new tickets start in.",
                  },
                  isClosedState: {
                    type: "boolean",
                    description:
                      "Whether this status counts as closed/resolved.",
                  },
                },
              },
            },
            customFields: {
              type: "array",
              description:
                "Admin-defined custom fields, in display order (empty if none configured). Send matching values in `POST /api/v1/tickets`'s `customFields`.",
              items: {
                type: "object",
                required: ["key", "label", "type", "required"],
                properties: {
                  key: {
                    type: "string",
                    description: "Stable machine key — the JSON key to send.",
                    examples: ["order_id"],
                  },
                  label: { type: "string", examples: ["Order ID"] },
                  type: {
                    type: "string",
                    enum: ["text", "number", "date", "checkbox", "select"],
                  },
                  options: {
                    type: "array",
                    items: { type: "string" },
                    description: "Only present when `type` is `select`.",
                  },
                  required: { type: "boolean" },
                },
              },
            },
            tags: {
              type: "array",
              description:
                "The shared tag pool agents pick from — alphabetical, not display-ordered (tags have no admin-defined order).",
              items: {
                type: "object",
                required: ["id", "name"],
                properties: {
                  id: { type: "string", examples: ["ckt1a2b3c4d5e6f"] },
                  name: { type: "string", examples: ["billing"] },
                },
              },
            },
          },
        },
      },
    },
  };
}
