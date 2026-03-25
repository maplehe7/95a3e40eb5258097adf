// This file is solely used for the automatically run GitHub job, which checks to
// see if all HU LTS code is working properly (at least on an Ubuntu machine).

const axios = require('axios');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const runtimeConfig = (() => {
  const config = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')
  );
  const ecosystem = require('./ecosystem.config.js');
  const ecosystemConfig =
    ecosystem.apps.find((app) => app.name === 'HolyUB') || ecosystem.apps[0];

  const port =
    ecosystemConfig[config.production ? 'env_production' : 'env']?.PORT || 8080;
  const pathname =
    (config.pathname || '/').replace(/\/+$|[^\w\/\.-]+/g, '') + '/';

  return { port, pathname };
})();

const baseUrl = `http://localhost:${runtimeConfig.port}${runtimeConfig.pathname}`;
const toLocalUrl = (target = '') => new URL(target, baseUrl).toString();

const testEndpoint = async (url) => {
  try {
    const response = await axios.get(url);
    return response.status === 200;
  } catch (error) {
    console.error(`Error ${error.code} while testing ${url}:`, error.message);
    return false;
  }
};

const generateUrl = async (omniboxId, urlPath, errorPrefix = 'failure') => {
  // Wait for the document to load before getting the omnibox.
  await new Promise((resolve) => {
    const waitLonger = () => setTimeout(resolve, 5000);
    if (document.readyState === 'complete') waitLonger();
    else window.addEventListener('load', waitLonger);
  });

  let omnibox = document.getElementById(omniboxId);
  omnibox = omnibox && omnibox.querySelector('input[type=text]');

  if (omnibox) {
    try {
      // Send an artificial input to the omnibox. The omnibox will create
      // a proxy URL and leave it as the input value in response.
      omnibox.value = urlPath;
      const generateInput = async () => {
        await omnibox.dispatchEvent(
          new KeyboardEvent('keydown', { code: 'Validator Test' })
        );
      };
      /* Keep trying to send an input signal every second until it works.
       * Implemented to account for a condition where the document has
       * finished loading, but the event handler for DOMContentLoaded has
       * not finished executing its script to listen for artificial inputs.
       */
      await generateInput();
      const inputInterval = setInterval(generateInput, 1000),
        resolveHandler = (resolve) => () => {
          clearInterval(inputInterval);
          resolve(omnibox.value);
        },
        // Wait up to 40 seconds for the omnibox to finish updating.
        loadUrl = new Promise((resolve) => {
          if (omnibox.value !== urlPath) resolveHandler(resolve)();
          else omnibox.addEventListener('change', resolveHandler(resolve));
        }),
        timeout = new Promise((resolve) => {
          setTimeout(resolveHandler(resolve), 40000);
        }),
        // Return the proxy URL that the omnibox left here.
        generatedUrl = await Promise.race([loadUrl, timeout]);
      return generatedUrl !== urlPath ? generatedUrl : errorPrefix;
    } catch (e) {
      return errorPrefix + ': ' + e.message;
    }
  } else {
    return errorPrefix + ': omnibox not defined';
  }
};

const testGeneratedUrl = async (url, headers) => {
  try {
    console.log('Testing generated URL:', url);

    const response = await axios.get(url, { headers });
    console.log(`Response status for ${url}:`, response.status);
    return response.status === 200;
  } catch (error) {
    console.error(`Error while testing generated URL ${url}:`, error.message);
    return false;
  }
};

const testServerResponse = async () => {
  const endpoints = [
    '',
    'test-404',
    'browsing',
    'physics',
    'networking',
    'documentation',
    'questions',
    's',
    'credits',
    'terms',
    'books',
    'dictionary',
    'catalogue',
    'textbook',
    'math',
    'wiki',
    'software',
    'whiteboard',
    'notebook',
    'assets/js/card.js',
    'assets/js/common-1735118314.js',
    'assets/js/csel.js',
    'assets/js/register-sw.js',
    'assets/json/emu-nav.json',
    'assets/json/blacklist.json',
    'assets/json/emulib-nav.json',
    'assets/json/flash-nav.json',
    'assets/json/h5-nav.json',
    'assets/json/links.json',
    'gmt/index.js',
    'gmt/worker.js',
    'epoch/index.mjs',
    'worker/working.all.js',
    'worker/working.sw.js',
    'worker/working.sw-blacklist.js',
    'network/networking.bundle.js',
    'network/networking.sw.js',
    'network/networking.config.js',
    'network/workerware.js',
    'network/WWError.js',
  ];

  const results = await Promise.all(
    endpoints.map((endpoint) => testEndpoint(toLocalUrl(endpoint)))
  );
  const allPassed = results.every((result) => result);

  if (allPassed) {
    console.log('All endpoints responded with status code 200. Test passed.');
    await testCommonJSOnPage();
  } else {
    console.error(
      'One or more endpoints failed to respond with status code 200. Test failed.'
    );
    process.exitCode = 1;
  }
};

const testCommonJSOnPage = async () => {
  const browser = await puppeteer.launch({
    args: [
      '--enable-features=NetworkService',
      '--enable-features=ServiceWorker',
      '--enable-features=InsecureOrigins',
    ],
    headless: true,
    ignoreHTTPSErrors: true,
  });
  const page = await browser.newPage();

  try {
    const getHeaders = async () => {
      const headers = {};

      headers['User-Agent'] = await page.evaluate(() => navigator.userAgent);
      headers['Referer'] = await page.evaluate(() => window.location.href);

      return headers;
    };

      const testRammerhead = async () => {
      const omniboxId = 'pr-rh',
        urlPath = 'example.com';
      await page.goto(toLocalUrl('physics'));
      const generatedUrl = await page.evaluate(generateUrl, omniboxId, urlPath);
      const testResults = {};
      testResults.rammerhead = generatedUrl;

      console.log('Rammerhead test results:', testResults);

      const headers = await getHeaders();
      const rammerheadTestPassed =
        testResults.rammerhead !== 'failure' &&
        (await testGeneratedUrl(testResults.rammerhead, headers));

      console.log(
        `Rammerhead test result: ${
          rammerheadTestPassed ? 'success' : 'failure'
        }`
      );

      return rammerheadTestPassed;
    };

    /*

                                                     xx   
  xx                                            xx    
   xxx                                        xx      
     xxx                                     xx       
       xxx                                  xx        
         xxx                              xx          
            xx                           xx           
             xx                         xx            
                                       xx             
                                      xx              
                                                      
                                                      
                                                      
                                                      
               x                    x                 
                                                      
                                                      
                                                      
                                                      
                                                      
                                                      
                        xxxxxxxxxxxxxxx               
             xxxxxxxxxxxx              xxxxx          
          xxxx                              xxx       
       xxx                                    xxx     
     xxx                                        xx    
    xx                                           xx   
   xx                                             xx  
 xxx                                               x  
 xx                                                 x 
xx                                                  xx

*/

    const testUltraviolet = async () => {
      const omniboxId = 'pr-uv',
        errorPrefix = 'failure',
        // For the hacky URL test further below, use the URL page's EXACT title.
        website = Object.freeze({
          path: 'example.com',
          title: 'Example Domain',
        });
      await page.goto(toLocalUrl('networking'));
      const generatedUrl = await page.evaluate(
        generateUrl,
        omniboxId,
        website.path,
        errorPrefix
      );

      const testResults = await page.evaluate(
        async (generatedUrl, pageTitle) => {
          const results = [{}, {}];

          await new Promise((resolve) => {
            const waitForDocument = () => {
                const waitLonger = () => setTimeout(resolve, 5000);
                if (document.readyState === 'complete') waitLonger();
                else window.addEventListener('load', waitLonger);
              },
              // Wait until a service worker is registered before continuing.
              // Also check again to make sure the document is loaded.
              waitForWorker = async () => {
                setTimeout(async () => {
                  (await navigator.serviceWorker.getRegistrations()).length > 0
                    ? waitForDocument()
                    : waitForWorker();
                }, 1000);
              };

            waitForWorker();
          });

          try {
            results[0].ultraviolet = generatedUrl;

            // Test to see if the document title for example.com has loaded,
            // by appending an IFrame to the document and grabbing its content.
            const testGeneratedUrlHacky = async (url) => {
              const exampleIFrame = document.createElement('iframe');
              const waitForDocument = new Promise((resolve) => {
                document.documentElement.appendChild(exampleIFrame);
                exampleIFrame.addEventListener('load', () => {
                  resolve(
                    exampleIFrame.contentWindow.document.title === pageTitle
                  );
                });
              });

              // Give 10 seconds for the IFrame to load before manually checking.
              const timeout = new Promise((resolve) => {
                setTimeout(() => {
                  resolve(
                    exampleIFrame.contentWindow.document.title === pageTitle
                  );
                }, 10000);
              });

              exampleIFrame.src = url;
              exampleIFrame.style.display = 'none';
              return await Promise.race([waitForDocument, timeout]);
            };

            results[1].uvTestPassed =
              !!results[0].ultraviolet.indexOf(errorPrefix) &&
              (await testGeneratedUrlHacky(results[0].ultraviolet));
          } catch (e) {
            results[0].ultraviolet = errorPrefix + ': ' + e.message;
          }

          return results;
        },
        generatedUrl,
        website.title,
        errorPrefix
      );

      console.log('Ultraviolet test results:', testResults[0]);
      const uvTestPassed =
        testResults[0].ultraviolet &&
        testResults[0].ultraviolet !== 'failure' &&
        testResults[1].uvTestPassed;
      console.log(
        'Ultraviolet test result:',
        uvTestPassed ? 'success' : 'failure'
      );
      return uvTestPassed;
    };

    // Run tests for Rammerhead and Ultraviolet.
    await page.goto(toLocalUrl(''));
    const rammerheadPassed = await testRammerhead();
    const ultravioletPassed = await testUltraviolet();

    if (rammerheadPassed && ultravioletPassed) {
      console.log('Both tests passed.');
      process.exitCode = 0;
    } else {
      console.error('Tests failed.');
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('Error in testCommonJSOnPage:', error.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
};

testServerResponse();
