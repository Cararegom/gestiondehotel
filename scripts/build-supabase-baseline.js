const fs = require("fs");
const path = require("path");

const snapshotsDir = path.join(process.cwd(), "supabase", "snapshots");
const outputFile =
  process.argv[2] ||
  path.join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260326191500_baseline_public_schema.sql",
  );

main();

function main() {
  const context = readJson(path.join(snapshotsDir, "database-context.json"));
  const functions = readJson(path.join(snapshotsDir, "public-functions.json"));
  const compositeTypes = readJson(
    path.join(snapshotsDir, "public-standalone-composite-types.json"),
  );
  const groupedCompositeTypes = groupCompositeTypes(compositeTypes);

  const database = context.databases.find((item) => item.name === "postgres");
  const publicSchema = database.schemas.find((item) => item.name === "public");

  if (!publicSchema) {
    throw new Error("No se encontro el schema public en el snapshot.");
  }

  const sqlParts = [];
  const allFunctionText = functions.map((item) => item.definition).join("\n\n");
  const neededExtensions = resolveNeededExtensions(publicSchema, allFunctionText);

  sqlParts.push("-- Baseline del schema public de Gestion de Hotel");
  sqlParts.push("-- Generado automaticamente desde snapshots del proyecto remoto Supabase.");
  sqlParts.push("-- Fecha de generacion: 2026-03-26");
  sqlParts.push("");
  sqlParts.push("BEGIN;");
  sqlParts.push("SET check_function_bodies = off;");
  sqlParts.push("");
  sqlParts.push("CREATE SCHEMA IF NOT EXISTS public;");
  sqlParts.push("");

  for (const statement of neededExtensions) {
    sqlParts.push(statement);
  }

  if (neededExtensions.length) {
    sqlParts.push("");
  }

  for (const type of compositeTypesToSql(groupedCompositeTypes)) {
    sqlParts.push(type, "");
  }

  for (const type of enumTypesToSql(publicSchema.types)) {
    sqlParts.push(type, "");
  }

  const sequences = collectSequences(publicSchema.tables);
  for (const sequenceStatement of sequences.map(sequenceToSql)) {
    sqlParts.push(sequenceStatement, "");
  }

  for (const table of publicSchema.tables) {
    sqlParts.push(tableToSql(table), "");
  }

  for (const table of publicSchema.tables) {
    const comments = commentsToSql(table);
    if (comments.length) {
      sqlParts.push(...comments, "");
    }
  }

  for (const table of publicSchema.tables) {
    const constraintStatements = constraintsToSql(table);
    if (constraintStatements.length) {
      sqlParts.push(...constraintStatements, "");
    }
  }

  for (const sequence of sequences) {
    sqlParts.push(
      `ALTER SEQUENCE ${qualify(sequence.schema, sequence.name)} OWNED BY ${qualify("public", sequence.table)}.${quoteIdent(sequence.column)};`,
      "",
    );
  }

  for (const table of publicSchema.tables) {
    const foreignKeys = foreignKeysToSql(table);
    if (foreignKeys.length) {
      sqlParts.push(...foreignKeys, "");
    }
  }

  for (const table of publicSchema.tables) {
    const indexes = indexesToSql(table);
    if (indexes.length) {
      sqlParts.push(...indexes, "");
    }
  }

  for (const fn of functions) {
    sqlParts.push(withSemicolon(normalizeDefinition(fn.definition)), "");
  }

  for (const table of publicSchema.tables) {
    if (table.is_rls_enabled) {
      sqlParts.push(
        `ALTER TABLE ${qualify("public", table.name)} ENABLE ROW LEVEL SECURITY;`,
      );
    }

    const policies = policiesToSql(table);
    if (policies.length) {
      sqlParts.push(...policies);
    }

    if (table.is_rls_enabled || policies.length) {
      sqlParts.push("");
    }
  }

  for (const table of publicSchema.tables) {
    const triggers = triggersToSql(table);
    if (triggers.length) {
      sqlParts.push(...triggers, "");
    }
  }

  sqlParts.push("COMMIT;");
  sqlParts.push("");

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, sqlParts.join("\n"), "utf8");

  console.log(
    JSON.stringify(
      {
        outputFile,
        tables: publicSchema.tables.length,
        enums: publicSchema.types.length,
        functions: functions.length,
        standaloneCompositeTypes: groupedCompositeTypes.length,
        sequences: sequences.length,
      },
      null,
      2,
    ),
  );
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function qualify(schema, name) {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`;
}

function normalizeDefinition(definition) {
  return String(definition || "").replace(/\r\n/g, "\n").trimEnd();
}

function resolveNeededExtensions(publicSchema, functionsText) {
  const typeSet = new Set();
  const defaultExpressions = [];

  for (const table of publicSchema.tables) {
    for (const column of table.columns || []) {
      typeSet.add(String(column.type || "").toLowerCase());
      if (column.default) {
        defaultExpressions.push(String(column.default).toLowerCase());
      }
    }
  }

  const combinedDefaults = defaultExpressions.join("\n");
  const combinedFunctions = String(functionsText || "").toLowerCase();
  const statements = [];

  if (typeSet.has("citext")) {
    statements.push('CREATE EXTENSION IF NOT EXISTS "citext" WITH SCHEMA public;');
  }

  if (
    combinedDefaults.includes("gen_random_uuid(") ||
    combinedFunctions.includes("gen_random_uuid(")
  ) {
    statements.push('CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;');
  }

  if (
    combinedDefaults.includes("uuid_generate_v4(") ||
    combinedFunctions.includes("uuid_generate_v4(")
  ) {
    statements.push('CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;');
  }

  return statements;
}

function compositeTypesToSql(types) {
  return types.map((type) => {
    const columns = type.columns.map((column) =>
      [
        `  ${quoteIdent(column.name)} ${column.data_type}`,
        column.is_not_null ? "NOT NULL" : "",
      ]
        .filter(Boolean)
        .join(" "),
    );

    return [
      `CREATE TYPE ${qualify("public", type.name)} AS (`,
      columns.join(",\n"),
      ");",
    ].join("\n");
  });
}

function groupCompositeTypes(rows) {
  const grouped = new Map();

  for (const row of rows || []) {
    if (!grouped.has(row.type_name)) {
      grouped.set(row.type_name, []);
    }

    grouped.get(row.type_name).push({
      name: row.column_name,
      data_type: row.data_type,
      is_not_null: row.is_not_null,
      ordinal_position: row.ordinal_position,
    });
  }

  return [...grouped.entries()].map(([name, columns]) => ({
    name,
    columns: columns.sort((left, right) => left.ordinal_position - right.ordinal_position),
  }));
}

function enumTypesToSql(types) {
  return (types || [])
    .filter((type) => type.type_kind === "enum")
    .map((type) => {
      const values = (type.enum_variants || [])
        .map((variant) => quoteLiteral(variant))
        .join(", ");
      return `CREATE TYPE ${qualify("public", type.name)} AS ENUM (${values});`;
    });
}

function collectSequences(tables) {
  const sequences = [];

  for (const table of tables) {
    for (const column of table.columns || []) {
      const match = String(column.default || "").match(
        /^nextval\('(?:(?<schema>[^'.]+)\.)?(?<name>[^']+)'::regclass\)$/i,
      );

      if (!match) continue;

      sequences.push({
        schema: match.groups?.schema || "public",
        name: match.groups?.name,
        table: table.name,
        column: column.name,
        dataType: column.type || "integer",
      });
    }
  }

  return sequences;
}

function sequenceToSql(sequence) {
  const asType =
    String(sequence.dataType).toLowerCase() === "bigint" ? "bigint" : "integer";
  return `CREATE SEQUENCE ${qualify(sequence.schema, sequence.name)} AS ${asType} START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;`;
}

function tableToSql(table) {
  const columns = (table.columns || []).map((column) => {
    const parts = [`  ${quoteIdent(column.name)} ${column.type}`];
    if (column.has_default && column.default !== null) {
      parts.push(`DEFAULT ${column.default}`);
    }
    if (!column.is_nullable) {
      parts.push("NOT NULL");
    }
    return parts.join(" ");
  });

  return [
    `CREATE TABLE ${qualify("public", table.name)} (`,
    columns.join(",\n"),
    ");",
  ].join("\n");
}

function commentsToSql(table) {
  const statements = [];
  if (table.comment) {
    statements.push(
      `COMMENT ON TABLE ${qualify("public", table.name)} IS ${quoteLiteral(table.comment)};`,
    );
  }

  for (const column of table.columns || []) {
    if (!column.comment) continue;
    statements.push(
      `COMMENT ON COLUMN ${qualify("public", table.name)}.${quoteIdent(column.name)} IS ${quoteLiteral(column.comment)};`,
    );
  }

  return statements;
}

function constraintsToSql(table) {
  return (table.constraints || []).map(
    (constraint) =>
      `ALTER TABLE ONLY ${qualify("public", table.name)} ADD CONSTRAINT ${quoteIdent(constraint.name)} ${constraint.definition};`,
  );
}

function foreignKeysToSql(table) {
  return (table.foreign_keys || []).map(
    (foreignKey) =>
      `ALTER TABLE ONLY ${qualify("public", table.name)} ADD CONSTRAINT ${quoteIdent(foreignKey.name)} ${foreignKey.definition};`,
  );
}

function indexesToSql(table) {
  const constraintBackedIndexes = new Set(
    (table.constraints || [])
      .filter((constraint) => ["p", "u"].includes(constraint.type))
      .map((constraint) => constraint.name),
  );

  return (table.indexes || [])
    .filter((index) => !constraintBackedIndexes.has(index.name))
    .map((index) => normalizeDefinition(index.definition) + ";");
}

function policiesToSql(table) {
  return (table.policies || []).map((policy) => {
    const lines = [
      `CREATE POLICY ${quoteIdent(policy.name)} ON ${qualify("public", table.name)}`,
      `  AS ${policy.permissive || "PERMISSIVE"}`,
      `  FOR ${policy.cmd || "ALL"}`,
    ];

    if (policy.roles && policy.roles.length) {
      lines.push(`  TO ${policy.roles.map(formatRole).join(", ")}`);
    }

    if (policy.qual) {
      lines.push(`  USING (${policy.qual})`);
    }

    if (policy.with_check) {
      lines.push(`  WITH CHECK (${policy.with_check})`);
    }

    lines[lines.length - 1] += ";";
    return lines.join("\n");
  });
}

function triggersToSql(table) {
  return (table.triggers || []).map((trigger) =>
    withSemicolon(normalizeDefinition(trigger.definition)),
  );
}

function withSemicolon(statement) {
  return statement.endsWith(";") ? statement : `${statement};`;
}

function formatRole(role) {
  const value = String(role);
  return /^[a-z_][a-z0-9_]*$/.test(value) ? value : quoteIdent(value);
}
