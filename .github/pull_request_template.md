# Pull Request Template

## Overview
<!-- Briefly describe the purpose and background of this pull request -->
Enhance the listing verification userscript so it checks active listings across all supported marketplaces, including Yahoo! Auctions, and produces a consolidated CSV report.

## Changes
<!-- List the main changes or added features -->
- Added Yahoo! Auctions listing collection with pagination support.
- Added Yahoo! Auctions navigation, session handling, and temporary page storage.
- Added Yahoo! Auctions results and unmatched items to the CSV output.
- Refactored shared pagination, storage, session cleanup, and error-handling logic.
- Updated userscript metadata and version to `16.0.0`.

## Testing
<!-- Describe how you tested the changes and what you verified -->
- Verified the JavaScript syntax with Tree-sitter.
- Ran `git diff --check` successfully.
- Verified the end-to-end navigation flow from the management page through Yahoo! Auctions.
- Verified that Yahoo! Auctions pagination data is preserved across page navigation.
- Verified that the CSV includes the Yahoo! Auctions column and final result.

## Related Issues
<!-- List any related issue numbers -->
- None.

## Notes
<!-- Add any notes or points to be aware of during review -->
- Marketplace selectors depend on the current DOM structure of each site and may require updates if the sites change their markup.
- A product is marked as passing only when it exists on Mercari Shops or Mercari, and also on Rakuma, Yahoo! Flea Market, and Yahoo! Auctions.
