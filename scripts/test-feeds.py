import feedparser

def validate_rss_feed(url):
    feed = feedparser.parse(url)
    
    if feed.bozo:
        print(f"Error: {feed.bozo_exception}")
    else:
        print("Feed is valid.")
        print(f"Feed Title: {feed.feed.title}")
        print(f"Feed Link: {feed.feed.link}")

if __name__ == "__main__":
    # Example RSS feed URL
    rss_url = "https://example.com/rss"
    validate_rss_feed(rss_url)