import urllib.request
import re

url = "https://scan-now.gsfc.nasa.gov/main-es2015.f7e7708d78a4138c84f0.js"
try:
    content = urllib.request.urlopen(url).read().decode('utf-8', errors='ignore')
    
    apis = set(re.findall(r'"([^"\'<>]*?(?:api|json|xml)[^"\'<>]*?)"', content))
    
    for a in apis:
        print("Candidate:", a)
except Exception as e:
    print(f"Error: {e}")
