# Organization Name Validation for Membership Form

## Overview

This implementation adds real-time validation to the membership form to check if an organization name is already registered as a PKIC member.

## Changes Made

### 1. Hugo JSON Data Generation
**File:** `layouts/members/list.members-data.json`

This Hugo template generates a JSON file at `/members/members-data.json` containing all current member organization names. The file is automatically regenerated whenever Hugo builds the site.

Example output:
```json
[
  {"title":"Entrust","id":"entrust"},
  {"title":"Sectigo","id":"sectigo"},
  {"title":"Keyfactor","id":"keyfactor"}
]
```

### 2. Hugo Configuration
**File:** `config.yaml`

Added the `members-data` output format to allow Hugo to generate the JSON file:
- Added `members-data` to the `outputFormats` section
- Added `members-data` to the `outputs.section` array

### 3. Form Validation JavaScript
**File:** `static/scripts/form.js`

Enhanced the existing form validation script with:
- **Data Loading**: Fetches the members data JSON on page load
- **Real-time Validation**: Checks organization names as users type (with 500ms debounce)
- **Blur Validation**: Also validates when the input field loses focus
- **Fuzzy Matching**: Detects exact matches and partial matches (e.g., "Entrust" matches "Entrust Corporation")
- **Visual Feedback**:
  - Displays a warning message below the organization field
  - Adds a yellow/warning border to the input field
  - Provides guidance to contact PKIC instead of submitting duplicate applications

## How It Works

1. When the page loads, JavaScript fetches `/members/members-data.json`
2. As users type in the "Organization Name" field, the validation:
   - Normalizes both the input and existing member names (lowercase, trimmed)
   - Checks for exact matches or partial matches
   - If a match is found, displays a warning message
3. The warning doesn't prevent submission but informs users they may be duplicating an existing membership

## Testing

A test file `test-validation.html` is included for standalone testing. Open it in a browser and try entering names like:
- "Entrust"
- "Sectigo"
- "Key" (will match "Keyfactor" and "Keytalk")

## Deployment

After building the site with Hugo, ensure:
1. The `/members/members-data.json` file is generated
2. The file is accessible from the web server
3. CORS headers allow the fetch request (should work since it's same-origin)

## Future Enhancements

Potential improvements:
- Add Levenshtein distance for better fuzzy matching
- Show which existing member was matched
- Add option to request membership under an existing organization
- Server-side validation before form submission
