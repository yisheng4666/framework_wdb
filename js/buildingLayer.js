//---------------------------------------------------------------------------
//  File: BuildingLayer.js
//  Change: 杨国强，创建于2016-11-14
//
//---------------------------------------------------------------------------

function BuildingLayer(layer) {
	if (!layer.data) {
		console.error("没有指定数据来源");
		return;
	}
	var geoData = layer.data;
	
	var parser;
	if (layer.dataFile.indexOf('geojson')>=0)
		parser = new ol.format.GeoJSON();
	else
		parser = new ol.format.TopoJSON();
	var features = parser.readFeatures(geoData);

	var drawMain = null; // 绘制主画布
	var drawPreview = null; // 绘制预览画布
	var vertexShaderStr = `
			precision lowp float;
			const float PI = 3.1415926536;
			const float RADIAN_HALF = PI/360.0;
			const float RADIAN_REVERSE = 180.0/PI;
			
			vec2 mercatorProjectViewport(
			  vec3 lnglat,
			  vec3 mapParam, // center lat, center lon, zoom
			  vec2 viewport // viewport: [width, height]
			) {
				// k calculated in JS
				// float k = pow(2.0, mapParam.z - 3.0) * TILE_SIZE;
				// y1 calculated in JS
				//float y1 = log(tan(PI / 4.0 + centerLngLat.y * PI / 360.0));
				float y2 = log(tan(PI / 4.0 + lnglat.y * RADIAN_HALF));
        return vec2( (lnglat.x - mapParam.x) * mapParam.z / viewport[0],
            (y2 - mapParam.y) * RADIAN_REVERSE * mapParam.z / viewport[1] );
			}

			attribute vec3 lineData;  // lat, lon, grade
			uniform vec3 mapParam;  // center lat, center lon, zoom
			uniform vec2 viewPort;
			uniform vec4 latlonRange;
			
			varying vec3 finalColor;
			const vec3 startColor = vec3(1.0,0.3,0.3);
			const vec3 midColor1 = vec3(1.0,0.6,0.6);
			const vec3 midColor2 = vec3(0.9,0.9,0.3);
			const vec3 midColor3 = vec3(0.3,0.9,0.3);
			const vec3 endColor = vec3(0.3,0.3,0.9);

			void main(void)
			{
		    float ratio = lineData[2]/16.0;
		    if (ratio>0.75) {
		    	if (ratio>1.0) ratio = 1.0;
		    	finalColor = midColor1 + (startColor-midColor1)*(ratio-0.75)*4.0;
		    } else if (ratio>0.5) {
		    	finalColor = midColor2+(midColor1-midColor2)*(ratio-0.5)*4.0;
		    } else if (ratio>0.25) {
		    	finalColor = midColor3+(midColor2-midColor3)*(ratio-0.25)*4.0;
		    } else {
		    	finalColor = endColor+(midColor3-endColor)*(ratio)*4.0;
		    }
		    if (latlonRange[0]<=0.0)
		    	gl_Position = vec4(mercatorProjectViewport(lineData, mapParam, viewPort), 0.0, 1.0);
		    else
		    	gl_Position = vec4((lineData[0]-latlonRange[0])/latlonRange[1],(lineData[1]-latlonRange[2])/latlonRange[3], 0.0, 1.0);
			}
	`;

	var fragmentShaderStr = `
      precision mediump float;
			uniform float layerOpacity;
			varying vec3 finalColor;

			void main(void)
			{
        gl_FragColor = vec4(finalColor, layerOpacity);
			}
	`;

	var vertexShaderAreaStr = `
			precision lowp float;
			const float PI = 3.1415926536;
			const float RADIAN_HALF = PI/360.0;
			const float RADIAN_REVERSE = 180.0/PI;
			
			vec2 mercatorProjectViewport(
			  vec2 lnglat,
			  vec3 mapParam, // center lat, center lon, zoom
			  vec2 viewport // viewport: [width, height]
			) {
				float y2 = log(tan(PI / 4.0 + lnglat.y * RADIAN_HALF));
        return vec2( (lnglat.x - mapParam.x) * mapParam.z / viewport[0],
            (y2 - mapParam.y) * RADIAN_REVERSE * mapParam.z / viewport[1] );
			}

			attribute vec2 traingleData;  // lat, lon
			uniform vec3 mapParam;  // center lat, center lon, zoom
			uniform vec2 viewPort;

			void main(void)
			{
	    	gl_Position = vec4(mercatorProjectViewport(traingleData, mapParam, viewPort), 0.0, 1.0);
			}
	`;

	var fragmentShaderAreaStr = `
      precision mediump float;
			uniform vec4 uColor;
			uniform float layerOpacity;

			void main(void)
			{
        gl_FragColor = uColor;
			}
	`;
	
	var lonRange = [360, -1];
	var latRange = [360, -1];
	var buf = [];
	const offsetLon = 0.0062;
	const offsetLat = 0.0014;
	function initCanvas() {		
		let index = 0;
		let min = Number.MAX_VALUE, max = Number.MIN_VALUE;
		for (let i=0,n=features.length;i<n;i++) {
			let f = features[i].getGeometry().flatCoordinates;
			let grade = parseInt(features[i].get('GRADE_LEVE'));
			if (!f || !f[0]) continue;
			let ext = features[i].getGeometry().getExtent();
			if (ext[0]<lonRange[0]) lonRange[0] = ext[0];
			if (ext[2]>lonRange[1]) lonRange[1] = ext[2];
			if (ext[1]<latRange[0]) latRange[0] = ext[1];
			if (ext[3]>latRange[1]) latRange[1] = ext[3];
			for (let j=0,jn=f.length;j<jn;j+=2) {
				f[j] += offsetLon;
				f[j+1] += offsetLat;
				buf[index++] = f[j];
				buf[index++] = f[j+1];
				buf[index++] = grade;
				if (j!=0) {
					buf[index++] = f[j];
					buf[index++] = f[j+1];
					buf[index++] = grade;
				}
			}
			buf[index++] = f[0];
			buf[index++] = f[1];
			buf[index++] = grade;
			
			features[i].fillBuf = f;

			//features[i].fillIndex = earcut(f);
		}
		
		let previewCanvas = document.getElementById('layerPreviewCanvas');
		let mainCanvas = document.getElementById('layerMainCanvas');
		drawMain = initWebGL(mainCanvas, 0);

	}

	function initWebGL(canvasObject, isPreview) {
		let webgl = canvasObject.getContext("webgl");
    var vertexShaderObject = webgl.createShader(webgl.VERTEX_SHADER);
    var fragmentShaderObject = webgl.createShader(webgl.FRAGMENT_SHADER);

    webgl.shaderSource(vertexShaderObject, vertexShaderStr);
    webgl.shaderSource(fragmentShaderObject, fragmentShaderStr);

    webgl.compileShader(vertexShaderObject);
    webgl.compileShader(fragmentShaderObject);

    if(!webgl.getShaderParameter(vertexShaderObject, webgl.COMPILE_STATUS)){console.error(webgl.getShaderInfoLog(vertexShaderObject));return;}
    if(!webgl.getShaderParameter(fragmentShaderObject, webgl.COMPILE_STATUS)){console.error(webgl.getShaderInfoLog(fragmentShaderObject));return;}

    var programObject = webgl.createProgram();

    webgl.attachShader(programObject, vertexShaderObject);
    webgl.attachShader(programObject, fragmentShaderObject);

    webgl.linkProgram(programObject);
    if(!webgl.getProgramParameter(programObject, webgl.LINK_STATUS)){console.error(webgl.getProgramInfoLog(programObject));return;}

    webgl.useProgram(programObject);

    var attrLineData = webgl.getAttribLocation(programObject, "lineData");
    var attrMapParam = webgl.getUniformLocation(programObject, "mapParam");
    var attrViewPort = webgl.getUniformLocation(programObject, "viewPort");
    //var attrColor = webgl.getUniformLocation(programObject, "uColor");
    var attrLatlonRange = webgl.getUniformLocation(programObject, "latlonRange");
    let attrOpacity = webgl.getUniformLocation(programObject, "layerOpacity");
   
    var lineBuffer = webgl.createBuffer();
    var traingleBuffer = webgl.createBuffer();
		let indexBuffer = webgl.createBuffer();
	  if (isPreview)
		  webgl.uniform4f(attrLatlonRange, lonRange[0]+(lonRange[1]-lonRange[0])/2, (lonRange[1]-lonRange[0])/2, latRange[0]+(latRange[1]-latRange[0])/2, (latRange[1]-latRange[0])/2);
		else
		  webgl.uniform4f(attrLatlonRange, -1, 0,0,0);
	  webgl.uniform1f(attrOpacity, 1);
		  
		webgl.bindBuffer(webgl.ARRAY_BUFFER, lineBuffer);
	  webgl.bufferData(webgl.ARRAY_BUFFER, new Float32Array(buf), webgl.DYNAMIC_DRAW);
	  webgl.enableVertexAttribArray(attrLineData); 
	  webgl.vertexAttribPointer(attrLineData, 3, webgl.FLOAT, false, 0, 0);

    //webgl.uniform3fv(attrColor, [1,1,1]);
    
    return function() {
    	webgl.useProgram(programObject);
    	
    	if (isPreview) {
			  webgl.clearColor(0.0, 0.0, 0.0, 0.8);
	    	webgl.clear(webgl.COLOR_BUFFER_BIT);
	    } else {
			  let center = map.center();
			  let size = map.size();
			  var mapedlat = Math.log(Math.tan(Math.PI / 4.0 + center.lat * Math.PI / 360.0));
			  var k = Math.pow(2, map.zoom() - 3) * 512.0 / 45.0;
			  webgl.uniform3fv(attrMapParam, [center.lon, mapedlat, k]);
			  webgl.uniform2fv(attrViewPort, [size.x,size.y]);
			  webgl.uniform1f(attrOpacity, layer.opacity);
		  }
		  
			webgl.bindBuffer(webgl.ARRAY_BUFFER, lineBuffer);
		  webgl.enableVertexAttribArray(attrLineData); 
		  webgl.vertexAttribPointer(attrLineData, 3, webgl.FLOAT, false, 0, 0);

		  webgl.drawArrays(webgl.LINES, 0, buf.length/3);
		}
	}
	
	function initArea(webgl, isSel) {
    var vertexShaderObject = webgl.createShader(webgl.VERTEX_SHADER);
    var fragmentShaderObject = webgl.createShader(webgl.FRAGMENT_SHADER);

    webgl.shaderSource(vertexShaderObject, vertexShaderAreaStr);
    webgl.shaderSource(fragmentShaderObject, fragmentShaderAreaStr);

    webgl.compileShader(vertexShaderObject);
    webgl.compileShader(fragmentShaderObject);

    if(!webgl.getShaderParameter(vertexShaderObject, webgl.COMPILE_STATUS)){console.error(webgl.getShaderInfoLog(vertexShaderObject));return;}
    if(!webgl.getShaderParameter(fragmentShaderObject, webgl.COMPILE_STATUS)){console.error(webgl.getShaderInfoLog(fragmentShaderObject));return;}

    var programObject = webgl.createProgram();

    webgl.attachShader(programObject, vertexShaderObject);
    webgl.attachShader(programObject, fragmentShaderObject);

    webgl.linkProgram(programObject);
    if(!webgl.getProgramParameter(programObject, webgl.LINK_STATUS)){console.error(webgl.getProgramInfoLog(programObject));return;}

    webgl.useProgram(programObject);

    var attrTraingleData = webgl.getAttribLocation(programObject, "traingleData");
    var attrMapParam = webgl.getUniformLocation(programObject, "mapParam");
    var attrViewPort = webgl.getUniformLocation(programObject, "viewPort");
    var attrColor = webgl.getUniformLocation(programObject, "uColor");
   
    var traingleBuffer = webgl.createBuffer();
		var indexBuffer = webgl.createBuffer();
    
    if (isSel)
 			webgl.uniform4fv(attrColor, [1,1,0.1, 0.7]);
 		else
 			webgl.uniform4fv(attrColor, [0.3,0.6,0.9, 0.5]);
 		
   	return function() {
   		
   		let fillBuf, fillIndex;
   		if (isSel) {
	   		if (!selFeatures || !selFeatures[0]) return;
   			fillBuf = selFeatures[0].fillBuf;
   			fillIndex = [].concat(selFeatures[0].fillIndex);
   			for (let i=1;i<selFeatures.length;i++) {
   				let idx = selFeatures[i].fillIndex;
   				let len = fillBuf.length/2;
   				for (let j=0;j<idx.length;j++)
   					fillIndex.push(idx[j]+len);
   				fillBuf = fillBuf.concat(selFeatures[i].fillBuf);
   			}
   		} else {
	   		if (!focusFeatures) return;
   			fillBuf = focusFeatures.fillBuf;
   			fillIndex = focusFeatures.fillIndex;
   		}
   		if (!fillBuf || !fillIndex) return;
   		 
    	webgl.useProgram(programObject);
		  let center = map.center();
		  let size = map.size();
		  let mapedlat = Math.log(Math.tan(Math.PI / 4.0 + center.lat * Math.PI / 360.0));
		  let k = Math.pow(2, map.zoom() - 3) * 512.0 / 45.0;
		  webgl.uniform3fv(attrMapParam, [center.lon, mapedlat, k]);
		  webgl.uniform2fv(attrViewPort, [size.x,size.y]);
	
			webgl.bindBuffer(webgl.ARRAY_BUFFER, traingleBuffer);
		  webgl.bufferData(webgl.ARRAY_BUFFER, new Float32Array(fillBuf), webgl.DYNAMIC_DRAW);
		  webgl.enableVertexAttribArray(attrTraingleData); 
		  webgl.vertexAttribPointer(attrTraingleData, 2, webgl.FLOAT, false, 0, 0);
	
			webgl.bindBuffer(webgl.ELEMENT_ARRAY_BUFFER, indexBuffer);
			webgl.bufferData(webgl.ELEMENT_ARRAY_BUFFER, new Uint16Array(fillIndex), webgl.DYNAMIC_DRAW);
		  
		  webgl.drawElements(webgl.TRIANGLES, fillIndex.length, webgl.UNSIGNED_SHORT, 0);
		
		}
	}
	
	initCanvas();

	function redrawMain() {
		if (drawMain) {
			drawMain();
		}
	}
	layer.onDraw = redrawMain;
	
	layer.onMouseMove = function(pos) {
		let coordinate = [pos.lon,pos.lat]; //ol.proj.fromLonLat([pos.lon,pos.lat]);
		let info = '';
		let theFeature = null;
    for (var i=0;i<features.length;i++) {
	    let geometry = features[i].getGeometry();
	    if (geometry.containsCoordinate(coordinate)) {
	    	theFeature = features[i];
      	info = '名称：'+features[i].get('NAME_CHN')+'\n层数：'+features[i].get('GRADE_LEVE');
      	break;
      }
    }
		setLayerPreviewInfo(layer.id, info);

	}
}
