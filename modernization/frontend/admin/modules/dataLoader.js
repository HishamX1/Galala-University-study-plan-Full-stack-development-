import { request } from './apiClient.js';
import { elements } from './adminDom.js';
import { cache } from './state.js';
import { renderLists, renderOptions } from './renderLists.js';
import { normalizeCatalog } from '../../shared/catalogNormalizer.js';

export async function loadRelations() {
  const catalog = normalizeCatalog(await request('/catalog'));
  cache.faculties = catalog.faculties || [];
  cache.programs = catalog.programs || [];
  cache.programCourses = catalog.programCourses || [];

  renderOptions(elements.ids.programFaculty, cache.faculties);
  renderOptions(elements.ids.courseProgram, cache.programs);
  renderLists();
}
