const fs = require("fs");
const path = require("path");

const projectRef =
  process.env.SUPABASE_PROJECT_REF ||
  safeRead(path.join(process.cwd(), "supabase", ".temp", "project-ref")) ||
  "";
const accessToken =
  process.env.SUPABASE_ACCESS_TOKEN ||
  process.env.SUPABASE_MANAGEMENT_TOKEN ||
  "";

if (!projectRef) {
  throw new Error(
    "SUPABASE_PROJECT_REF no esta definido y no se encontro supabase/.temp/project-ref.",
  );
}

if (!accessToken) {
  throw new Error(
    "SUPABASE_ACCESS_TOKEN no esta definido. Usa un Personal Access Token de Supabase.",
  );
}

const outputDir = path.join(process.cwd(), "supabase", "snapshots");

main().catch((error) => {
  console.error("[fetch-supabase-schema-snapshot] Error:", error);
  process.exitCode = 1;
});

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const context = await apiRequest(`/database/context`, { method: "GET" });
  writeJson("database-context.json", context);

  const publicFunctions = await apiQuery(`
    select
      p.proname,
      pg_get_function_identity_arguments(p.oid) as args,
      pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    left join pg_depend d
      on d.classid = 'pg_proc'::regclass
     and d.objid = p.oid
     and d.deptype = 'e'
    where n.nspname = 'public'
      and p.prokind in ('f','p')
      and d.objid is null
    order by p.proname, args;
  `);
  writeJson("public-functions.json", publicFunctions);

  const standaloneCompositeTypes = await apiQuery(`
    select
      t.typname as type_name,
      a.attnum as ordinal_position,
      a.attname as column_name,
      format_type(a.atttypid, a.atttypmod) as data_type,
      a.attnotnull as is_not_null
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    join pg_class c on c.oid = t.typrelid
    join pg_attribute a on a.attrelid = c.oid
    where n.nspname = 'public'
      and t.typtype = 'c'
      and t.typname not in (
        select table_name
        from information_schema.tables
        where table_schema = 'public'
      )
      and a.attnum > 0
      and not a.attisdropped
    order by t.typname, a.attnum;
  `);
  writeJson("public-standalone-composite-types.json", standaloneCompositeTypes);

  const publicSchema = context.databases
    .find((database) => database.name === "postgres")
    ?.schemas.find((schema) => schema.name === "public");

  console.log(
    JSON.stringify(
      {
        projectRef,
        snapshots: outputDir,
        tables: publicSchema?.tables?.length || 0,
        enums: publicSchema?.types?.length || 0,
        functions: publicFunctions.length,
        standaloneCompositeTypes: groupCompositeTypes(standaloneCompositeTypes).length,
      },
      null,
      2,
    ),
  );
}

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return "";
  }
}

async function apiQuery(query) {
  const result = await apiRequest(`/database/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      read_only: true,
    }),
  });

  return Array.isArray(result) ? result : result.value || [];
}

async function apiRequest(endpoint, options = {}) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}${endpoint}`,
    {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(options.headers || {}),
      },
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${body}`);
  }

  return response.json();
}

function groupCompositeTypes(rows) {
  const grouped = new Map();

  for (const row of rows) {
    if (!grouped.has(row.type_name)) {
      grouped.set(row.type_name, []);
    }

    grouped.get(row.type_name).push({
      name: row.column_name,
      data_type: row.data_type,
      is_not_null: row.is_not_null,
    });
  }

  return [...grouped.entries()].map(([name, columns]) => ({ name, columns }));
}

function writeJson(fileName, value) {
  fs.writeFileSync(
    path.join(outputDir, fileName),
    JSON.stringify(value, null, 2),
    "utf8",
  );
}
