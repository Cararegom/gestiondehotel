export const DEFAULT_SUPABASE_PAGE_SIZE = 1000;

/**
 * Recorre una consulta PostgREST hasta obtener la ultima pagina.
 * El query debe incluir un orden estable para evitar saltos entre paginas.
 */
export async function fetchAllWithPagination(
  queryBuilder,
  { pageSize = DEFAULT_SUPABASE_PAGE_SIZE } = {}
) {
  if (!queryBuilder || typeof queryBuilder.range !== 'function') {
    throw new TypeError('Se requiere una consulta Supabase con soporte de paginacion.');
  }
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new TypeError('El tamano de pagina debe ser un entero positivo.');
  }

  const allData = [];
  let from = 0;

  while (true) {
    const { data, error } = await queryBuilder.range(from, from + pageSize - 1);
    if (error) return { data: null, error };

    if (!Array.isArray(data)) {
      return {
        data: null,
        error: new Error('La consulta paginada devolvio una respuesta invalida.')
      };
    }

    const page = data;
    allData.push(...page);

    if (page.length < pageSize) break;
    from += pageSize;
  }

  return { data: allData, error: null };
}
