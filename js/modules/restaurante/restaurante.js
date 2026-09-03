import * as restauranteLegacy from './restaurante-legacy.js';

const DUPLICATE_USAGE_WINDOW_MS = 15000;

function createRestaurantSupabaseProxy(supabase) {
  let usoAtomicoPendiente = null;

  return new Proxy(supabase, {
    get(target, property, receiver) {
      if (property !== 'rpc') {
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      }

      return async (functionName, args = {}, options) => {
        if (functionName === 'procesar_venta_restaurante_atomica') {
          const result = await target.rpc('procesar_venta_restaurante_atomica', args, options);
          if (!result?.error && result?.data?.venta_id && args?.p_descuento_id) {
            usoAtomicoPendiente = {
              descuentoId: String(args.p_descuento_id),
              registradoEn: Date.now()
            };
          } else {
            usoAtomicoPendiente = null;
          }
          return result;
        }

        if (functionName === 'incrementar_uso_descuento' && usoAtomicoPendiente) {
          const descuentoId = String(args?.descuento_id_param || '');
          const dentroVentana = Date.now() - usoAtomicoPendiente.registradoEn <= DUPLICATE_USAGE_WINDOW_MS;
          const esMismoDescuento = descuentoId && descuentoId === usoAtomicoPendiente.descuentoId;

          if (dentroVentana && esMismoDescuento) {
            usoAtomicoPendiente = null;
            return { data: null, error: null };
          }

          if (!dentroVentana) usoAtomicoPendiente = null;
        }

        return target.rpc(functionName, args, options);
      };
    }
  });
}

export async function mount(container, supabase, user) {
  return restauranteLegacy.mount(container, createRestaurantSupabaseProxy(supabase), user);
}

export function unmount(container) {
  return restauranteLegacy.unmount(container);
}
