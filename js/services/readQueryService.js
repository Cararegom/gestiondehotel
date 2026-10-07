const NETWORK_MESSAGE = /^(?:TypeError:\s*)?(?:Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?)$/i;

function isNetworkFailure(result) {
  return result?.status === 0
    && !result.error?.code
    && NETWORK_MESSAGE.test(String(result.error?.message || ''));
}

/** Solo para SELECT: reconstruye la consulta y reintenta una vez un fallo de red. */
export async function readQueryWithNetworkRetry(buildReadQuery) {
  let result;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      result = await buildReadQuery();
    } catch (error) {
      result = { data: null, error };
      if (error?.name === 'TypeError' && NETWORK_MESSAGE.test(error.message)) {
        result.status = 0;
      }
    }
    if (!isNetworkFailure(result) || attempt === 1) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  // Conservar el estado HTTP al propagar errores de consultas relacionadas.
  return result?.error && result.status !== undefined
    ? { ...result, error: { ...result.error, message: result.error.message, name: result.error.name, status: result.status } }
    : result;
}

export async function readRelatedRowsInBatches(supabase, table, columns, column, ids) {
  const rows = [];
  for (let index = 0; index < ids.length; index += 100) {
    const batch = ids.slice(index, index + 100);
    const { data, error } = await readQueryWithNetworkRetry(() => supabase
      .from(table)
      .select(columns)
      .in(column, batch));
    if (error) throw error;
    rows.push(...(data || []));
  }
  return rows;
}
