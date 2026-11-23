import { useState } from 'react';
import { api } from '../api';
import { PubGrid, Filters } from './Inbox';
import { useAsync } from '../ui';

export function Library() {
  const [filters, setFilters] = useState<Record<string, string>>({ sort: 'date' });
  const brands = useAsync(() => api('/brands'), []);
  return (
    <>
      <div className="title-row"><div><span className="eyebrow">BIBLIOTECA</span><h1>Contenidos aprobados</h1><p className="muted">Todo lo que el equipo aprobó, listo para programar. Búsqueda por texto, marca, categoría y fecha.</p></div></div>
      <Filters value={filters} onChange={setFilters} brands={brands.data?.brands ?? []} showStatus={false} />
      <PubGrid filters={filters} fixed={{ endpoint: 'library' }} empty="Aún no hay contenidos aprobados." />
    </>
  );
}
