// The grid every publicly-readable location is snapped to before it is
// returned or compared, in degrees (~1km at the equator, less at higher
// latitudes): coarse enough that repeated reads from different points can't
// triangulate an exact address. One constant shared by every repository
// that exposes a PostGIS point publicly (profiles search, the request feed,
// the public job board), so there is one precision to reason about, not one
// per feature.
export const LOCATION_GRID_DEGREES = 0.01;
