#!/usr/bin/env python3
"""
RSS Feed Validation Script for PKIC Members

This script validates RSS feeds from member YAML files to prevent Hugo build
timeouts caused by broken or slow feeds.

Features:
- Reads all member YAML files from data/members/
- Extracts RSS feed URLs from each member's blog.feed field
- Validates each feed with a 10-second timeout
- Performs HEAD then GET requests to check Content-Type
- Parses feeds using feedparser to detect malformed XML and missing entries
- Runs validations concurrently using ThreadPoolExecutor (default 10 workers)
- Produces detailed summary report
- Exits with non-zero code if any feed is invalid or times out

Usage:
    python3 scripts/test-feeds.py

The script will:
1. Load all member YAML files
2. Extract blog.feed URLs
3. Validate each feed concurrently
4. Print a detailed report
5. Exit with code 0 if all feeds are valid, or 1 if any feed fails

Requirements:
- feedparser
- requests
- pyyaml
"""

import os
import sys
import yaml
import time
import requests
import feedparser
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List, Tuple, Optional

# Configuration
TIMEOUT_SECONDS = 10
MAX_WORKERS = 10
MEMBERS_DIR = "data/members"


class FeedValidationResult:
    """Represents the result of a feed validation"""
    
    def __init__(self, url: str, member_id: str):
        self.url = url
        self.member_id = member_id
        self.valid = False
        self.status = "unknown"
        self.content_type = None
        self.error_message = None
        self.response_time = None
        self.feed_title = None
        self.entry_count = None
        self.warnings = []
    
    def __repr__(self):
        return f"FeedValidationResult(url={self.url}, valid={self.valid}, status={self.status})"


def load_member_feeds(members_dir: str) -> List[Tuple[str, str]]:
    """
    Load all member YAML files and extract RSS feed URLs.
    
    Args:
        members_dir: Path to the directory containing member YAML files
        
    Returns:
        List of tuples containing (member_id, feed_url)
    """
    feeds = []
    members_path = Path(members_dir)
    
    if not members_path.exists():
        print(f"Error: Members directory not found: {members_dir}")
        return feeds
    
    yaml_files = list(members_path.glob("*.yaml"))
    print(f"Found {len(yaml_files)} member files to process")
    
    for yaml_file in yaml_files:
        try:
            with open(yaml_file, 'r', encoding='utf-8') as f:
                data = yaml.safe_load(f)
                
            if not data:
                continue
                
            member_id = data.get('id', yaml_file.stem)
            
            # Extract blog.feed URL
            blog = data.get('blog', {})
            if blog and isinstance(blog, dict):
                feed_url = blog.get('feed', '')
                
                # Handle None values
                if feed_url is None:
                    feed_url = ''
                    
                feed_url = feed_url.strip()
                
                # Skip empty feeds or commented out feeds
                if feed_url and not feed_url.startswith('#'):
                    feeds.append((member_id, feed_url))
                    
        except Exception as e:
            print(f"Warning: Failed to parse {yaml_file.name}: {e}")
            continue
    
    print(f"Found {len(feeds)} RSS feeds to validate")
    return feeds


def check_content_type(url: str, timeout: int) -> Tuple[bool, Optional[str], Optional[str]]:
    """
    Check if the URL returns a valid RSS/XML content type.
    
    Args:
        url: The feed URL to check
        timeout: Request timeout in seconds
        
    Returns:
        Tuple of (is_valid, content_type, error_message)
    """
    try:
        # Try HEAD request first (faster)
        response = requests.head(url, timeout=timeout, allow_redirects=True)
        content_type = response.headers.get('content-type', '').lower()
        
        # If HEAD doesn't give us content-type, try GET
        if not content_type or 'html' in content_type:
            response = requests.get(url, timeout=timeout, stream=True)
            content_type = response.headers.get('content-type', '').lower()
        
        # Check if it's a valid feed content type
        valid_types = ['xml', 'rss', 'atom', 'application/rss+xml', 
                      'application/atom+xml', 'text/xml', 'application/xml']
        
        is_valid = any(valid_type in content_type for valid_type in valid_types)
        
        # Check for HTML responses (common mistake)
        if 'html' in content_type:
            return False, content_type, "Content-Type is HTML, not XML/RSS"
        
        if not is_valid:
            return False, content_type, f"Invalid Content-Type: {content_type}"
            
        return True, content_type, None
        
    except requests.exceptions.Timeout:
        return False, None, "Request timeout during content-type check"
    except requests.exceptions.RequestException as e:
        return False, None, f"Request error: {str(e)}"


def validate_feed(member_id: str, url: str, timeout: int = TIMEOUT_SECONDS) -> FeedValidationResult:
    """
    Validate a single RSS feed.
    
    Args:
        member_id: The member identifier
        url: The feed URL to validate
        timeout: Request timeout in seconds
        
    Returns:
        FeedValidationResult object with validation details
    """
    result = FeedValidationResult(url, member_id)
    start_time = time.time()
    
    try:
        # Step 1: Check content type
        is_valid_type, content_type, error_msg = check_content_type(url, timeout)
        result.content_type = content_type
        
        if not is_valid_type:
            result.status = "invalid_content_type"
            result.error_message = error_msg
            return result
        
        # Step 2: Parse feed with feedparser
        # Set timeout by using requests session
        response = requests.get(url, timeout=timeout)
        result.response_time = time.time() - start_time
        
        # Parse the feed
        feed = feedparser.parse(response.content)
        
        # Check for parsing errors (bozo bit)
        if feed.bozo:
            result.status = "parsing_error"
            result.error_message = f"Feed parsing error: {feed.bozo_exception}"
            # Check if it's a minor issue we can warn about
            if isinstance(feed.bozo_exception, feedparser.CharacterEncodingOverride):
                result.warnings.append("Character encoding override applied")
                # Continue validation for minor encoding issues
            else:
                return result
        
        # Check if feed has required fields
        if not hasattr(feed, 'feed'):
            result.status = "invalid_structure"
            result.error_message = "Feed does not have required 'feed' structure"
            return result
        
        # Extract feed information
        result.feed_title = feed.feed.get('title', 'No title')
        
        # Check for entries
        if not hasattr(feed, 'entries') or len(feed.entries) == 0:
            result.status = "no_entries"
            result.error_message = "Feed has no entries"
            result.warnings.append("Feed parsed successfully but contains no entries")
            # This is a warning, not a failure
            result.valid = True
            return result
        
        result.entry_count = len(feed.entries)
        
        # Validation successful
        result.valid = True
        result.status = "valid"
        
    except requests.exceptions.Timeout:
        result.status = "timeout"
        result.error_message = f"Request timeout after {timeout} seconds"
        result.response_time = timeout
        
    except requests.exceptions.RequestException as e:
        result.status = "request_error"
        result.error_message = f"Request error: {str(e)}"
        result.response_time = time.time() - start_time
        
    except Exception as e:
        result.status = "unknown_error"
        result.error_message = f"Unexpected error: {str(e)}"
        result.response_time = time.time() - start_time
    
    return result


def validate_feeds_concurrent(feeds: List[Tuple[str, str]], 
                              max_workers: int = MAX_WORKERS,
                              timeout: int = TIMEOUT_SECONDS) -> List[FeedValidationResult]:
    """
    Validate multiple feeds concurrently.
    
    Args:
        feeds: List of tuples containing (member_id, feed_url)
        max_workers: Maximum number of concurrent workers
        timeout: Request timeout in seconds
        
    Returns:
        List of FeedValidationResult objects
    """
    results = []
    
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Submit all validation tasks
        future_to_feed = {
            executor.submit(validate_feed, member_id, url, timeout): (member_id, url)
            for member_id, url in feeds
        }
        
        # Collect results as they complete
        for future in as_completed(future_to_feed):
            try:
                result = future.result()
                results.append(result)
                
                # Print progress
                status_icon = "✓" if result.valid else "✗"
                print(f"{status_icon} {result.member_id}: {result.status}")
                
            except Exception as e:
                member_id, url = future_to_feed[future]
                print(f"✗ {member_id}: Exception during validation: {e}")
                result = FeedValidationResult(url, member_id)
                result.status = "exception"
                result.error_message = str(e)
                results.append(result)
    
    return results


def print_summary(results: List[FeedValidationResult]) -> int:
    """
    Print a detailed summary of validation results.
    
    Args:
        results: List of FeedValidationResult objects
        
    Returns:
        Exit code (0 if all valid, 1 if any failures)
    """
    print("\n" + "=" * 80)
    print("RSS FEED VALIDATION SUMMARY")
    print("=" * 80)
    
    valid_feeds = [r for r in results if r.valid]
    invalid_feeds = [r for r in results if not r.valid]
    
    print(f"\nTotal feeds checked: {len(results)}")
    print(f"Valid feeds: {len(valid_feeds)}")
    print(f"Invalid feeds: {len(invalid_feeds)}")
    
    if valid_feeds:
        print("\n" + "-" * 80)
        print("VALID FEEDS:")
        print("-" * 80)
        for result in sorted(valid_feeds, key=lambda x: x.member_id):
            print(f"  ✓ {result.member_id}")
            print(f"    URL: {result.url}")
            print(f"    Title: {result.feed_title}")
            print(f"    Entries: {result.entry_count}")
            print(f"    Response time: {result.response_time:.2f}s")
            if result.warnings:
                for warning in result.warnings:
                    print(f"    Warning: {warning}")
            print()
    
    if invalid_feeds:
        print("\n" + "-" * 80)
        print("INVALID FEEDS:")
        print("-" * 80)
        for result in sorted(invalid_feeds, key=lambda x: x.member_id):
            print(f"  ✗ {result.member_id}")
            print(f"    URL: {result.url}")
            print(f"    Status: {result.status}")
            print(f"    Error: {result.error_message}")
            if result.content_type:
                print(f"    Content-Type: {result.content_type}")
            if result.response_time:
                print(f"    Response time: {result.response_time:.2f}s")
            print()
    
    print("=" * 80)
    
    # Return exit code
    return 0 if len(invalid_feeds) == 0 else 1


def main():
    """Main entry point for the feed validation script"""
    print("Starting RSS feed validation...")
    print(f"Configuration: timeout={TIMEOUT_SECONDS}s, workers={MAX_WORKERS}")
    print()
    
    # Get the script directory to find members directory
    script_dir = Path(__file__).parent.parent
    members_dir = script_dir / MEMBERS_DIR
    
    # Load feeds from member YAML files
    feeds = load_member_feeds(str(members_dir))
    
    if not feeds:
        print("No RSS feeds found to validate")
        return 0
    
    print()
    print(f"Validating {len(feeds)} feeds...")
    print()
    
    # Validate feeds concurrently
    results = validate_feeds_concurrent(feeds, MAX_WORKERS, TIMEOUT_SECONDS)
    
    # Print summary and return exit code
    exit_code = print_summary(results)
    
    if exit_code == 0:
        print("\n✓ All RSS feeds are valid!")
    else:
        print("\n✗ Some RSS feeds failed validation")
        print("Please fix the invalid feeds or remove them from member YAML files")
    
    return exit_code


if __name__ == "__main__":
    sys.exit(main())