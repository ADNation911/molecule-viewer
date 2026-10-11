export function createDensityCard(map) {
  const card = document.createElement('article');
  card.className = 'density-card';
  card.dataset.densityId = map.id;

  const heading = document.createElement('div');
  heading.className = 'density-card-heading';
  const title = document.createElement('strong');
  title.textContent = map.name;
  title.title = `${map.dimensions.join(' × ')} grid · ${map.voxelCount.toLocaleString()} voxels`;
  const headingActions = document.createElement('div');
  const visibility = document.createElement('button');
  visibility.className = 'object-icon';
  visibility.dataset.densityVisibility = map.id;
  visibility.title = map.visible ? 'Hide density map' : 'Show density map';
  visibility.setAttribute('aria-label', visibility.title);
  visibility.textContent = map.visible ? '●' : '○';
  const remove = document.createElement('button');
  remove.className = 'object-icon';
  remove.dataset.removeDensity = map.id;
  remove.setAttribute('aria-label', `Remove ${map.name}`);
  remove.textContent = '×';
  headingActions.append(visibility, remove);
  heading.append(title, headingActions);

  const controls = document.createElement('div');
  controls.className = 'density-controls';
  const isoLabel = document.createElement('label');
  isoLabel.textContent = 'Isovalue';
  const iso = document.createElement('input');
  Object.assign(iso, { type: 'number', min: '0.000001', max: '1000000', step: '0.001', value: map.isovalue });
  iso.dataset.densityIso = map.id;
  isoLabel.append(iso);
  const opacityLabel = document.createElement('label');
  opacityLabel.textContent = `Opacity ${Math.round(map.opacity * 100)}%`;
  const opacity = document.createElement('input');
  Object.assign(opacity, { type: 'range', min: '10', max: '100', step: '5', value: String(map.opacity * 100) });
  opacity.dataset.densityOpacity = map.id;
  opacityLabel.append(opacity);
  controls.append(isoLabel, opacityLabel);

  const options = document.createElement('div');
  options.className = 'density-options';
  const negativeLabel = document.createElement('label');
  const negative = document.createElement('input');
  negative.type = 'checkbox';
  negative.checked = map.negative;
  negative.dataset.densityNegative = map.id;
  negativeLabel.append(negative, document.createTextNode(' ± contours'));
  const wireLabel = document.createElement('label');
  const wire = document.createElement('input');
  wire.type = 'checkbox';
  wire.checked = map.wireframe;
  wire.dataset.densityWire = map.id;
  wireLabel.append(wire, document.createTextNode(' Mesh'));
  const positiveColor = document.createElement('input');
  positiveColor.type = 'color';
  positiveColor.value = map.color;
  positiveColor.dataset.densityColor = map.id;
  positiveColor.title = 'Positive contour color';
  const negativeColor = document.createElement('input');
  negativeColor.type = 'color';
  negativeColor.value = map.negativeColor;
  negativeColor.dataset.densityNegativeColor = map.id;
  negativeColor.title = 'Negative contour color';
  options.append(negativeLabel, wireLabel, positiveColor, negativeColor);
  card.append(heading, controls, options);
  return card;
}

export function createSceneRow(scene) {
  const row = document.createElement('div');
  row.className = 'scene-row';
  const apply = document.createElement('button');
  apply.className = 'scene-apply';
  apply.dataset.sceneId = scene.id;
  const title = document.createElement('strong');
  title.textContent = scene.name;
  apply.append(title);
  const buttons = document.createElement('div');
  const remove = document.createElement('button');
  remove.className = 'object-icon';
  remove.dataset.removeScene = scene.id;
  remove.textContent = '×';
  remove.setAttribute('aria-label', `Delete ${scene.name}`);
  buttons.append(remove);
  row.append(apply, buttons);
  return row;
}
