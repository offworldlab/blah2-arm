// Whether this node knows where it and its illuminator are.
//
// retina-node ships the geometry null until an owner picks a tower, so a node
// straight out of the box has none. Every read of config.location in server.js
// is a bistatic calculation on the ADS-B truth path, and none of it was
// guarded: dereferencing config.location.rx.latitude throws, and where it does
// not, lla2ecef turns nulls into NaN so every comparison against a tolerance is
// false and the association silently matches nothing.
//
// Its own module because server.js opens listeners the moment it is required,
// so nothing inside it can be unit tested.

// Present and numeric. `!= null` catches null and undefined; the finite check
// rejects the NaN a string coordinate would become in lla2ecef. Zero passes:
// 0,0 is a real place an owner can choose.
function isCoordinate(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

// Altitude counts: it feeds lla2ecef too, and the tower step writes a
// position's fields together, so a missing one means a partial config rather
// than a node at sea level.
function isPosition(position) {
  return !!position
    && isCoordinate(position.latitude)
    && isCoordinate(position.longitude)
    && isCoordinate(position.altitude);
}

// Both ends, because a receiver with no illuminator gives no bistatic geometry
// at all. Half a location is worth exactly as much as none.
function hasLocation(config) {
  const location = config && config.location;
  return !!location && isPosition(location.rx) && isPosition(location.tx);
}

module.exports = { hasLocation, isPosition, isCoordinate };
