import urllib.request
import re

url = "https://scan-now.gsfc.nasa.gov/main-es2015.f7e7708d78a4138c84f0.js"
try:
    content = urllib.request.urlopen(url).read().decode('utf-8', errors='ignore')
    urls = set(re.findall(r'https?://[^\s"\'<>]+', content))
    local_urls = set(re.findall(r'\/api\/[a-zA-Z0-9_\-\/]+', content))
    
    print("APIs found in URL:", url)
    print("Absolute URLs with 'api':", [u for u in urls if 'api' in u or 'scan' in u])
    print("Local paths with 'api':", local_urls)
except Exception as e:
    print(f"Error: {e}")
