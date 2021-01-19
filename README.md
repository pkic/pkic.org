# pkic.org website

## How to add a new member

1. Create a `new-member-name.yaml` in the `data/members` folder.
2. Create a `new-member-name.md` in the `content/members` folder.
3. Add the logo in SVG format in the folder `assets/images/members`, the filename must correspondent with id of the member (e.g., `member.svg`)

## How to add a new author?
- For member authors, add a representative in the `data/members/memer.yaml` file.
- For authors that are not associated with a member, add a listing in `data/authors.yaml`.

## Formatting content
The content lives in `content/` and is written as markdown because of it's simple content format. We do not allow the usage of HTML, this to enforce uniform and structured content, but there are times when Markdown falls short. For some of these reusable cases you can use built-in [shortcodes](https://gohugo.io/content-management/shortcodes/) or use/create a custom [shortcode](https://gohugo.io/templates/shortcode-templates/).

- [Basic Markdown Syntax](https://www.markdownguide.org/basic-syntax/)