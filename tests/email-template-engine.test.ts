import { describe, it, expect } from "vitest";
import { compileSimpleTemplate, renderSubject } from "../functions/_lib/email/render";

describe("email template engine (compileSimpleTemplate)", () => {
  describe("variable substitution", () => {
    it("replaces simple variables", () => {
      const result = compileSimpleTemplate("Hello {{name}}", { name: "Alice" });
      expect(result).toBe("Hello Alice");
    });

    it("replaces multiple variables", () => {
      const result = compileSimpleTemplate("{{greeting}} {{name}}, welcome to {{event}}", {
        greeting: "Welcome",
        name: "Bob",
        event: "PKI Summit",
      });
      expect(result).toBe("Welcome Bob, welcome to PKI Summit");
    });

    it("leaves unresolved placeholders as-is", () => {
      const result = compileSimpleTemplate("Hello {{name}}, your code is {{code}}", { name: "Charlie" });
      expect(result).toBe("Hello Charlie, your code is {{code}}");
    });

    it("handles null/undefined variables gracefully", () => {
      const result = compileSimpleTemplate("Value: {{missing}}", { missing: null });
      expect(result).toBe("Value: {{missing}}");
    });

    it("converts non-string values to strings", () => {
      const result = compileSimpleTemplate("Count: {{num}}, Active: {{bool}}", {
        num: 42,
        bool: true,
      });
      expect(result).toBe("Count: 42, Active: true");
    });
  });

  describe("if conditionals (truthy check)", () => {
    it("renders if block when variable is truthy", () => {
      const result = compileSimpleTemplate("{{#if confirmed}}You are confirmed{{/if}}", {
        confirmed: true,
      });
      expect(result).toBe("You are confirmed");
    });

    it("skips if block when variable is falsy", () => {
      const result = compileSimpleTemplate("{{#if confirmed}}Confirmed{{/if}}", {
        confirmed: false,
      });
      expect(result).toBe("");
    });

    it("treats empty string as falsy", () => {
      const result = compileSimpleTemplate("{{#if status}}Active{{/if}}", { status: "" });
      expect(result).toBe("");
    });

    it("treats '0' as falsy", () => {
      const result = compileSimpleTemplate("{{#if count}}Has items{{/if}}", { count: "0" });
      expect(result).toBe("");
    });

    it("treats 'false' string as falsy", () => {
      const result = compileSimpleTemplate("{{#if flag}}True{{/if}}", { flag: "false" });
      expect(result).toBe("");
    });

    it("supports else block", () => {
      const result = compileSimpleTemplate("{{#if vip}}VIP access{{else}}Standard access{{/if}}", {
        vip: false,
      });
      expect(result).toBe("Standard access");
    });

    it("prefers if block over else when truthy", () => {
      const result = compileSimpleTemplate(
        "{{#if attending}}Will attend{{else}}Cannot attend{{/if}}",
        { attending: true }
      );
      expect(result).toBe("Will attend");
    });
  });

  describe("unless conditional", () => {
    it("renders unless block when variable is falsy", () => {
      const result = compileSimpleTemplate("{{#unless cancelled}}Event is happening{{/unless}}", {
        cancelled: false,
      });
      expect(result).toBe("Event is happening");
    });

    it("skips unless block when variable is truthy", () => {
      const result = compileSimpleTemplate("{{#unless cancelled}}Event on{{/unless}}", {
        cancelled: true,
      });
      expect(result).toBe("");
    });
  });

  describe("comparison operators", () => {
    describe("eq (equal)", () => {
      it("renders if strings match", () => {
        const result = compileSimpleTemplate("{{#if eq status \"confirmed\"}}Confirmed{{/if}}", {
          status: "confirmed",
        });
        expect(result).toBe("Confirmed");
      });

      it("does not render if strings differ", () => {
        const result = compileSimpleTemplate("{{#if eq status \"confirmed\"}}Yes{{/if}}", {
          status: "pending",
        });
        expect(result).toBe("");
      });

      it("supports else block", () => {
        const result = compileSimpleTemplate(
          "{{#if eq attendance \"remote\"}}Online{{else}}In-person{{/if}}",
          { attendance: "remote" }
        );
        expect(result).toBe("Online");
      });
    });

    describe("ne (not equal)", () => {
      it("renders when strings differ", () => {
        const result = compileSimpleTemplate("{{#if ne status \"cancelled\"}}Still active{{/if}}", {
          status: "confirmed",
        });
        expect(result).toBe("Still active");
      });

      it("does not render when strings match", () => {
        const result = compileSimpleTemplate("{{#if ne status \"cancelled\"}}Active{{/if}}", {
          status: "cancelled",
        });
        expect(result).toBe("");
      });
    });

    describe("numeric comparisons (gt, gte, lt, lte)", () => {
      it("gt: renders when value > literal", () => {
        const result = compileSimpleTemplate("{{#if gt count \"5\"}}Many{{/if}}", { count: "10" });
        expect(result).toBe("Many");
      });

      it("gt: does not render when value <= literal", () => {
        const result = compileSimpleTemplate("{{#if gt count \"5\"}}Many{{/if}}", { count: "3" });
        expect(result).toBe("");
      });

      it("gte: renders when value >= literal", () => {
        const result = compileSimpleTemplate("{{#if gte rating \"4.5\"}}Good{{/if}}", { rating: "4.5" });
        expect(result).toBe("Good");
      });

      it("lt: renders when value < literal", () => {
        const result = compileSimpleTemplate("{{#if lt daysLeft \"3\"}}Hurry{{/if}}", { daysLeft: "1" });
        expect(result).toBe("Hurry");
      });

      it("lte: renders when value <= literal", () => {
        const result = compileSimpleTemplate("{{#if lte slots \"0\"}}Sold out{{/if}}", { slots: "0" });
        expect(result).toBe("Sold out");
      });

      it("handles decimal numbers", () => {
        const result = compileSimpleTemplate(
          "{{#if gt discount \"0.25\"}}High discount{{/if}}",
          { discount: "0.5" }
        );
        expect(result).toBe("High discount");
      });

      it("does not render if strings cannot parse as numbers", () => {
        const result = compileSimpleTemplate("{{#if gt score \"100\"}}Perfect{{/if}}", {
          score: "abc",
        });
        expect(result).toBe("");
      });
    });
  });

  describe("each loops", () => {
    it("iterates over array items", () => {
      const result = compileSimpleTemplate("{{#each items}}{{this}} {{/each}}", {
        items: ["apple", "banana", "cherry"],
      });
      expect(result).toBe("apple banana cherry ");
    });

    it("supports {{this}} to reference current item", () => {
      const result = compileSimpleTemplate("{{#each names}}Hello {{this}}, {{/each}}", {
        names: ["Alice", "Bob"],
      });
      expect(result).toBe("Hello Alice, Hello Bob, ");
    });

    it("supports {{.}} as alias for {{this}}", () => {
      const result = compileSimpleTemplate("{{#each days}}Day: {{.}} {{/each}}", {
        days: ["Mon", "Tue"],
      });
      expect(result).toBe("Day: Mon Day: Tue ");
    });

    it("provides {{@index}} (0-based)", () => {
      const result = compileSimpleTemplate("{{#each items}}[{{@index}}]={{this}} {{/each}}", {
        items: ["x", "y", "z"],
      });
      expect(result).toBe("[0]=x [1]=y [2]=z ");
    });

    it("provides {{@first}} for first iteration", () => {
      const result = compileSimpleTemplate(
        "{{#each items}}{{#if @first}}FIRST:{{/if}}{{this}} {{/each}}",
        { items: ["a", "b"] }
      );
      expect(result).toBe("FIRST:a b ");
    });

    it("helps resolve last iteration properly in conditionals", () => {
      const result = compileSimpleTemplate(
        "{{#each items}}{{this}}{{#if @last}} <-- END{{/if}} {{/each}}",
        { items: ["a", "b", "c"] }
      );
      expect(result).toBe("a b c <-- END ");
    });

    it("skips loop if variable is not an array", () => {
      const result = compileSimpleTemplate("{{#each notArray}}Item{{/each}}", { notArray: "string" });
      expect(result).toBe("");
    });

    it("handles empty arrays", () => {
      const result = compileSimpleTemplate("{{#each items}}Item{{/each}}", { items: [] });
      expect(result).toBe("");
    });

    it("can access array of objects", () => {
      const result = compileSimpleTemplate(
        "{{#each attendees}}Name: {{name}}, {{/each}}",
        {
          attendees: [
            { name: "Alice" },
            { name: "Bob" },
          ],
        }
      );
      expect(result).toBe("Name: Alice, Name: Bob, ");
    });
  });

  describe("logical operators (and/or)", () => {
    describe("and operator", () => {
      it("renders when all variables are truthy", () => {
        const result = compileSimpleTemplate("{{#if and flagA flagB}}Both true{{/if}}", {
          flagA: true,
          flagB: true,
        });
        expect(result).toBe("Both true");
      });

      it("does not render when any variable is falsy", () => {
        const result = compileSimpleTemplate("{{#if and flagA flagB}}Both true{{/if}}", {
          flagA: true,
          flagB: false,
        });
        expect(result).toBe("");
      });

      it("supports more than 2 conditions", () => {
        const result = compileSimpleTemplate(
          "{{#if and a b c}}All three{{/if}}",
          { a: true, b: true, c: true }
        );
        expect(result).toBe("All three");
      });

      it("fails if any of 3+ conditions is falsy", () => {
        const result = compileSimpleTemplate(
          "{{#if and a b c}}All three{{/if}}",
          { a: true, b: true, c: false }
        );
        expect(result).toBe("");
      });

      it("supports else block", () => {
        const result = compileSimpleTemplate(
          "{{#if and admin confirmed}}Approve{{else}}No access{{/if}}",
          { admin: true, confirmed: false }
        );
        expect(result).toBe("No access");
      });
    });

    describe("or operator", () => {
      it("renders when at least one variable is truthy", () => {
        const result = compileSimpleTemplate("{{#if or flagA flagB}}At least one{{/if}}", {
          flagA: false,
          flagB: true,
        });
        expect(result).toBe("At least one");
      });

      it("does not render when all variables are falsy", () => {
        const result = compileSimpleTemplate("{{#if or flagA flagB}}Any true{{/if}}", {
          flagA: false,
          flagB: false,
        });
        expect(result).toBe("");
      });

      it("supports multiple conditions", () => {
        const result = compileSimpleTemplate(
          "{{#if or x y z}}Any true{{/if}}",
          { x: false, y: false, z: true }
        );
        expect(result).toBe("Any true");
      });

      it("supports else block", () => {
        const result = compileSimpleTemplate(
          "{{#if or premium vip}}Special rates{{else}}Regular price{{/if}}",
          { premium: false, vip: false }
        );
        expect(result).toBe("Regular price");
      });
    });
  });

  describe("complex real-world scenarios", () => {
    it("email with event details and conditional venue info", () => {
      const template = `Dear {{attendeeName}},

Your registration for {{eventName}} is confirmed.

**Event Details:**
- Date: {{eventDate}}
- Time: {{eventTime}}

{{#if eq attendance "remote"}}
**Join Online:**
Zoom Link: {{zoomUrl}}
{{else}}
**Venue:**
{{venueName}}
{{address}}
{{/if}}

Best regards,
PKI Consortium`;

      const result = compileSimpleTemplate(template, {
        attendeeName: "Alice",
        eventName: "PQC Summit 2026",
        eventDate: "March 15, 2026",
        eventTime: "09:00 AM",
        attendance: "remote",
        zoomUrl: "https://zoom.us/meeting/123",
        venueName: "Convention Center",
        address: "123 Main St",
      });

      expect(result).toContain("Dear Alice");
      expect(result).toContain("PQC Summit 2026");
      expect(result).toContain("Zoom Link: https://zoom.us/meeting/123");
      expect(result).not.toContain("Convention Center");
    });

    it("email with loop over attendance days and nested conditionals", () => {
      const template = `You are attending:
{{#each days}}
- Day {{@index}}: {{this}}{{#if @last}} (final day){{/if}}
{{/each}}

See you there!`;

      const result = compileSimpleTemplate(template, {
        days: ["Monday", "Tuesday", "Wednesday"],
      });

      expect(result).toContain("- Day 0: Monday");
      expect(result).toContain("- Day 2: Wednesday (final day)");
      expect(result).not.toContain("- Day 1: Tuesday (final day)");
    });

    it("email with multiple attendees and conditional message", () => {
      const template = `Invitation for {{eventName}}

{{#each attendees}}
Attendee {{@index}}: {{name}} ({{email}})
{{/each}}

{{#if and confirmAll isRemote}}
All attendees confirmed for remote attendance via {{zoomLink}}
{{else}}
Please confirm your attendance.
{{/if}}`;

      const result = compileSimpleTemplate(template, {
        eventName: "Security Workshop",
        attendees: [
          { name: "Alice", email: "alice@example.com" },
          { name: "Bob", email: "bob@example.com" },
        ],
        confirmAll: true,
        isRemote: true,
        zoomLink: "https://zoom.us/j/456",
      });

      expect(result).toContain("Attendee 0: Alice");
      expect(result).toContain("Attendee 1: Bob");
      expect(result).toContain("All attendees confirmed for remote attendance");
    });

    it("email with dietary restrictions loop", () => {
      const template = `Dietary requirements registered:
{{#each dietary}}
- {{this}}
{{/each}}

{{#if gt dietary_count "0"}}Special accommodations will be arranged.{{/if}}`;

      const result = compileSimpleTemplate(template, {
        dietary: ["Vegetarian", "Gluten-free"],
        dietary_count: "2",
      });

      expect(result).toContain("- Vegetarian");
      expect(result).toContain("- Gluten-free");
      expect(result).toContain("Special accommodations will be arranged.");
    });
  });

  describe("edge cases and robustness", () => {
    it("handles empty template", () => {
      const result = compileSimpleTemplate("", { foo: "bar" });
      expect(result).toBe("");
    });

    it("handles template with no variables", () => {
      const result = compileSimpleTemplate("Static text only", { foo: "bar" });
      expect(result).toBe("Static text only");
    });

    it("handles whitespace in conditionals", () => {
      const result = compileSimpleTemplate("{{#if   confirmed  }}OK{{/if}}", { confirmed: true });
      expect(result).toBe("OK");
    });

    it("handles multiline blocks", () => {
      const result = compileSimpleTemplate(
        `{{#if active}}
Line 1
Line 2
{{/if}}`,
        { active: true }
      );
      expect(result).toContain("Line 1");
      expect(result).toContain("Line 2");
    });

    it("does not interfere with HTML entities", () => {
      const result = compileSimpleTemplate("Price: {{price}} &copy; 2026", { price: "$50" });
      expect(result).toBe("Price: $50 &copy; 2026");
    });

    it("preserves special characters in variable values", () => {
      const result = compileSimpleTemplate("{{email}}", { email: "user+test@example.com" });
      expect(result).toBe("user+test@example.com");
    });

    it("handles variable names case-sensitively", () => {
      const result = compileSimpleTemplate("{{name}} vs {{Name}}", {
        name: "lowercase",
        Name: "Uppercase",
      });
      expect(result).toBe("lowercase vs Uppercase");
    });

    it("leaves malformed placeholders as-is", () => {
      const result = compileSimpleTemplate("{{name}} {name} {{ name }} {{name", { name: "test" });
      expect(result).toContain("test");
      expect(result).toContain("{name}");
      expect(result).toContain("{{ name }}");
      expect(result).toContain("{{name");
    });
  });

  describe("subject rendering (renderSubject)", () => {
    it("renders conditional subject templates", () => {
      const subject = renderSubject(
        "{{#if isReminder}}{{#if lte daysUntilExpiry \"2\"}}Last chance{{else}}Friendly reminder{{/if}}{{else}}Welcome{{/if}}",
        "Fallback Subject",
        { isReminder: true, daysUntilExpiry: "1" },
      );
      expect(subject).toBe("Last chance");
    });

    it("falls back when template is null", () => {
      const subject = renderSubject(null, "Default Subject", { isReminder: true });
      expect(subject).toBe("Default Subject");
    });

    it("honors explicit subject override", () => {
      const subject = renderSubject(
        "{{#if isReminder}}Reminder{{else}}Welcome{{/if}}",
        "Fallback",
        { isReminder: true, __subjectOverride: "Custom subject variant" },
      );
      expect(subject).toBe("Custom subject variant");
    });
  });
});
