export const OPERATIONAL_ROOM_STATES = Object.freeze([
  'ocupada',
  'tiempo agotado',
]);

const OPERATIONAL_ROOM_STATE_SET = new Set(OPERATIONAL_ROOM_STATES);

export function buildOperationalRoomStateBatches(rooms) {
  const batchesByState = new Map();
  const seenRoomIds = new Set();

  for (const room of Array.isArray(rooms) ? rooms : []) {
    const roomId = room?.id;
    const roomIdKey = String(roomId || '').trim();
    const targetState = room?.estado;

    if (
      !room?.needsOperationalResync
      || !roomIdKey
      || !OPERATIONAL_ROOM_STATE_SET.has(targetState)
      || targetState === room?.estado_base
      || seenRoomIds.has(roomIdKey)
    ) {
      continue;
    }

    seenRoomIds.add(roomIdKey);

    if (!batchesByState.has(targetState)) {
      batchesByState.set(targetState, {
        estado: targetState,
        roomIds: [],
        rooms: [],
      });
    }

    const batch = batchesByState.get(targetState);
    batch.roomIds.push(roomId);
    batch.rooms.push(room);
  }

  return [...batchesByState.values()];
}

function reportBatchError(onError, detail) {
  if (typeof onError === 'function') {
    onError(detail);
  }
}

export async function syncOperationalRoomStates(
  rooms,
  supabase,
  hotelId,
  { onError } = {},
) {
  const batches = buildOperationalRoomStateBatches(rooms);
  const summary = {
    requested: batches.reduce((total, batch) => total + batch.rooms.length, 0),
    updated: 0,
    failed: 0,
    requests: 0,
  };

  if (batches.length === 0 || !supabase || !hotelId) {
    return summary;
  }

  summary.requests = batches.length;

  const results = await Promise.all(batches.map(async (batch) => {
    try {
      const result = await supabase
        .from('habitaciones')
        .update({ estado: batch.estado })
        .eq('hotel_id', hotelId)
        .in('id', batch.roomIds)
        .select('id');

      return { batch, result };
    } catch (error) {
      return { batch, result: { data: null, error } };
    }
  }));

  for (const { batch, result } of results) {
    if (result?.error || !Array.isArray(result?.data)) {
      summary.failed += batch.rooms.length;
      reportBatchError(onError, {
        reason: result?.error ? 'request_failed' : 'invalid_response',
        estado: batch.estado,
        roomIds: [...batch.roomIds],
        error: result?.error || new Error('M12_INVALID_ROOM_STATE_SYNC_RESPONSE'),
      });
      continue;
    }

    const updatedIds = new Set(result.data.map((row) => String(row?.id || '').trim()).filter(Boolean));
    const missingRoomIds = [];

    for (const room of batch.rooms) {
      if (!updatedIds.has(String(room.id).trim())) {
        missingRoomIds.push(room.id);
        summary.failed += 1;
        continue;
      }

      room.estado_base = batch.estado;
      room.needsOperationalResync = false;
      summary.updated += 1;
    }

    if (missingRoomIds.length > 0) {
      reportBatchError(onError, {
        reason: 'rows_not_updated',
        estado: batch.estado,
        roomIds: missingRoomIds,
        error: new Error('M12_ROOM_STATE_ROWS_NOT_UPDATED'),
      });
    }
  }

  return summary;
}
