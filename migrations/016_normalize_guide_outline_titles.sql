-- SPDX-License-Identifier: AGPL-3.0-only
with normalized_titles as (
  select
    id,
    btrim(
      regexp_replace(
        title,
        '^[[:space:]]*(step|étape|etape|schritt|céim|ceim)[[:space:]]+[0-9]+[[:space:]]*((of|sur|von|de|as)[[:space:]]+|/[[:space:]]*)[0-9]+[[:space:]]*(:|—|–|-)?[[:space:]]*',
        '',
        'i'
      )
    ) as descriptive_title,
    left(regexp_replace(btrim(body), '[[:space:]]+', ' ', 'g'), 500) as body_title
  from guide_items
  where
    kind = 'step'
    and title ~* '^[[:space:]]*(step|étape|etape|schritt|céim|ceim)[[:space:]]+[0-9]+[[:space:]]*((of|sur|von|de|as)[[:space:]]+|/[[:space:]]*)[0-9]+'
)
update guide_items as item
set
  title = coalesce(
    nullif(normalized.descriptive_title, ''),
    nullif(normalized.body_title, ''),
    'Untitled step'
  ),
  updated_at = now()
from normalized_titles as normalized
where item.id = normalized.id;
